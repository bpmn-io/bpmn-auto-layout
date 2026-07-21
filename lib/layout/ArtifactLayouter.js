import { is, getDefaultSize } from '../di/DiUtil.js';
import { LayoutError } from '../LayoutError.js';
import {
  ROUTING_MARGIN,
  VERTICAL_GAP,
  PARTICIPANT_HEADER_WIDTH,
  ANNOTATION_MIN_WIDTH,
  ANNOTATION_MAX_WIDTH,
  ANNOTATION_WIDTH_STEP,
  ANNOTATION_CHARACTER_WIDTH,
  ANNOTATION_LINE_HEIGHT,
  ANNOTATION_PADDING,
  ANNOTATION_MIN_HEIGHT,
  ANNOTATION_TARGET_ASPECT_RATIO,
  ANNOTATION_ASPECT_RATIO_PENALTY_SCALE,
  MAX_ARTIFACT_SEARCH_OFFSET,
  MAX_ARTIFACT_GAP_STEPS,
  NON_STRAIGHT_ARTIFACT_ASSOCIATION_PENALTY,
  BOUNDARY_EVENT_ARTIFACT_CLEARANCE
} from './Constants.js';
import {
  point,
  bounds,
  rectanglesOverlap,
  routeLength,
  toSegments,
  segmentEntersRect,
  segmentsProperlyCross,
  compareScores
} from './LayoutUtil.js';
import { pathIsClear } from './SequenceFlowRouter.js';

export function findContainingArtifactContainers(elementBounds, shapes) {
  const center = {
    x: elementBounds.x + elementBounds.width / 2,
    y: elementBounds.y + elementBounds.height / 2
  };

  return [ ...shapes.entries() ]
    .filter(([ element, rect ]) => {
      return (
        is(element, 'bpmn:Lane') ||
        is(element, 'bpmn:Participant') ||
        is(element, 'bpmn:SubProcess')
      ) &&
      center.x >= rect.x &&
      center.x <= rect.x + rect.width &&
      center.y >= rect.y &&
      center.y <= rect.y + rect.height;
    })
    .map(([ , rect ]) => rect)
    .sort((a, b) => a.width * a.height - b.width * b.height);
}

function associationConnection(association, owner, ownerBounds, artifact, artifactBounds) {
  let ownerPoint;
  let artifactPoint;

  if (artifactBounds.y + artifactBounds.height <= ownerBounds.y) {
    ownerPoint = point(ownerBounds.x + ownerBounds.width / 2, ownerBounds.y);
    artifactPoint = point(
      artifactBounds.x + artifactBounds.width / 2,
      artifactBounds.y + artifactBounds.height
    );
  } else if (ownerBounds.y + ownerBounds.height <= artifactBounds.y) {
    ownerPoint = point(
      ownerBounds.x + ownerBounds.width / 2,
      ownerBounds.y + ownerBounds.height
    );
    artifactPoint = point(artifactBounds.x + artifactBounds.width / 2, artifactBounds.y);
  } else if (artifactBounds.x + artifactBounds.width <= ownerBounds.x) {
    ownerPoint = point(ownerBounds.x, ownerBounds.y + ownerBounds.height / 2);
    artifactPoint = point(
      artifactBounds.x + artifactBounds.width,
      artifactBounds.y + artifactBounds.height / 2
    );
  } else if (ownerBounds.x + ownerBounds.width <= artifactBounds.x) {
    ownerPoint = point(
      ownerBounds.x + ownerBounds.width,
      ownerBounds.y + ownerBounds.height / 2
    );
    artifactPoint = point(artifactBounds.x, artifactBounds.y + artifactBounds.height / 2);
  } else {
    const artifactAbove = artifactBounds.y + artifactBounds.height / 2 <
      ownerBounds.y + ownerBounds.height / 2;
    ownerPoint = point(
      ownerBounds.x + ownerBounds.width / 2,
      artifactAbove ? ownerBounds.y : ownerBounds.y + ownerBounds.height
    );
    artifactPoint = point(
      artifactBounds.x + artifactBounds.width / 2,
      artifactAbove ? artifactBounds.y + artifactBounds.height : artifactBounds.y
    );
  }

  const artifactIsSource = is(association, 'bpmn:DataInputAssociation') ||
    association.sourceRef === artifact ||
    (Array.isArray(association.sourceRef) && association.sourceRef.includes(artifact));

  return artifactIsSource
    ? [ artifactPoint, ownerPoint ]
    : [ ownerPoint, artifactPoint ];
}

export function artifactSizeCandidates(element) {
  if (!is(element, 'bpmn:TextAnnotation')) {
    return [ getDefaultSize(element) ];
  }

  const text = element.text || '';
  const candidates = [];

  for (
    let width = ANNOTATION_MIN_WIDTH;
    width <= ANNOTATION_MAX_WIDTH;
    width += ANNOTATION_WIDTH_STEP
  ) {
    const lineCount = wrappedTextLineCount(text, width);
    const height = Math.max(
      ANNOTATION_MIN_HEIGHT,
      lineCount * ANNOTATION_LINE_HEIGHT + 2 * ANNOTATION_PADDING
    );

    candidates.push({ width, height });
  }

  return candidates.sort((a, b) => {
    return annotationSizePenalty(a) - annotationSizePenalty(b) ||
      a.width * a.height - b.width * b.height ||
      a.width - b.width;
  });
}

function wrappedTextLineCount(text, width) {
  const capacity = Math.max(
    1,
    Math.floor((width - 2 * ANNOTATION_PADDING) / ANNOTATION_CHARACTER_WIDTH)
  );

  return String(text || '').split(/\r?\n/).reduce((total, paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);

    if (!words.length) {
      return total + 1;
    }

    let lines = 1;
    let lineLength = 0;

    for (const word of words) {
      const wordLength = word.length;

      if (!lineLength) {
        lines += Math.max(0, Math.ceil(wordLength / capacity) - 1);
        lineLength = wordLength % capacity || Math.min(wordLength, capacity);
      } else if (lineLength + 1 + wordLength <= capacity) {
        lineLength += 1 + wordLength;
      } else {
        lines += Math.max(1, Math.ceil(wordLength / capacity));
        lineLength = wordLength % capacity || Math.min(wordLength, capacity);
      }
    }

    return total + lines;
  }, 0);
}

function annotationSizePenalty(size) {
  return Math.round(
    Math.abs(size.width / size.height - ANNOTATION_TARGET_ASPECT_RATIO) *
    ANNOTATION_ASPECT_RATIO_PENALTY_SCALE
  );
}

export function findArtifactPlacement(
    artifact,
    ownerBounds,
    references,
    sizes,
    obstacles,
    routes,
    occupied,
    container,
    processContainer,
    extents,
    annotationClearance = 0,
    boundaryContainers = []) {
  const localCandidates = ownerBounds
    ? ownedArtifactCandidates(artifact, ownerBounds, sizes)
    : unownedArtifactCandidates(sizes, extents);
  const candidates = is(artifact, 'bpmn:TextAnnotation')
    ? [
      ...localCandidates,
      ...outerScopeArtifactCandidates(sizes, extents)
    ]
    : localCandidates;
  const routeSegments = routes.flatMap(route => toSegments(route.points));
  const requiresContainment = is(artifact, 'bpmn:DataObjectReference');
  const rankedCandidates = candidates.map(candidate => {
    const routedReferences = references.map(({
      association,
      owner,
      ownerBounds
    }) => {
      const points = ownerBounds && associationConnection(
        association,
        owner,
        ownerBounds,
        artifact,
        candidate.rect
      );
      return points && { owner, points };
    }).filter(Boolean);
    const directLength = routedReferences.reduce((total, { points }) => {
      return total + routeLength(points);
    }, 0);
    const lowerBound = [
      directLength,
      directLength,
      is(artifact, 'bpmn:TextAnnotation')
        ? annotationSizePenalty(candidate.rect)
        : 0,
      0,
      0,
      artifactExpansion(candidate.rect, extents),
      candidate.sideRank,
      Math.abs(candidate.offset),
      candidate.gap,
      candidate.rect.y,
      candidate.rect.x
    ];

    return { candidate, lowerBound, routedReferences };
  }).sort((a, b) => compareScores(a.lowerBound, b.lowerBound));

  let best;

  for (const {
    candidate,
    lowerBound,
    routedReferences
  } of rankedCandidates) {
    if (best && compareScores(lowerBound, best.score) >= 0) {
      break;
    }

    const candidateBounds = artifactClearanceBounds(
      artifact,
      candidate.rect,
      annotationClearance
    );
    const fitsContainer = artifactFitsContainer(candidateBounds, container, 0);
    const fitsProcessContainer = artifactFitsContainer(
      candidateBounds,
      processContainer,
      0
    );
    const straddlesContainer = container &&
      rectanglesOverlap(candidateBounds, container) &&
      !fitsContainer;
    const straddlesProcessContainer = processContainer &&
      rectanglesOverlap(candidateBounds, processContainer) &&
      !fitsProcessContainer;
    const violatesContainerBoundary = boundaryContainers.some(({
      rect,
      containsOwner,
      participant
    }) => {
      if (participant && rectanglesOverlap(candidateBounds, {
        x: rect.x,
        y: rect.y,
        width: PARTICIPANT_HEADER_WIDTH,
        height: rect.height
      })) {
        return true;
      }

      if (!rectanglesOverlap(candidateBounds, rect)) {
        return false;
      }

      return !containsOwner || !artifactFitsContainer(candidateBounds, rect, 0);
    });
    const overlapsParticipantHeader = container &&
      candidateBounds.y < container.y + container.height &&
      candidateBounds.y + candidateBounds.height > container.y &&
      candidateBounds.x < container.x &&
      candidateBounds.x + candidateBounds.width >
        container.x - PARTICIPANT_HEADER_WIDTH;

    if ((requiresContainment && !fitsContainer) ||
        straddlesContainer ||
        straddlesProcessContainer ||
        violatesContainerBoundary ||
        overlapsParticipantHeader ||
        obstacles.some(({ element, rect }) => {
          const obstacle = is(element, 'bpmn:BoundaryEvent')
            ? artifactObstacleBounds(rect)
            : rect;

          return rectanglesOverlap(candidateBounds, obstacle);
        }) ||
        occupied.some(({ element, rect, annotationClearance }) => {
          return rectanglesOverlap(
            candidateBounds,
            artifactClearanceBounds(element, rect, annotationClearance)
          );
        }) ||
        artifactIntersectsRoutes(candidate.rect, routeSegments)) {
      continue;
    }

    const directPathsClear = routedReferences.every(({ owner, points }) => {
      return pathIsClear(
        points,
        obstacles,
        owner,
        artifact,
        []
      );
    });

    if (!directPathsClear) {
      continue;
    }

    const associationRoutes = routedReferences.map(({ points }) => points);
    const associationLength = associationRoutes.reduce((total, points) => {
      return total + routeLength(points);
    }, 0);
    const nonStraightPenalty = is(artifact, 'bpmn:TextAnnotation')
      ? associationRoutes.reduce((total, points) => {
        return total + (
          isStraightOrthogonalRoute(points)
            ? 0
            : NON_STRAIGHT_ARTIFACT_ASSOCIATION_PENALTY
        );
      }, 0)
      : 0;
    const score = [
      associationLength + nonStraightPenalty,
      associationLength,
      is(artifact, 'bpmn:TextAnnotation')
        ? annotationSizePenalty(candidate.rect)
        : 0,
      associationRoutes.reduce((total, points) => {
        return total + routeCrossings(points, routeSegments);
      }, 0),
      !is(artifact, 'bpmn:TextAnnotation') && (
        (container && !fitsContainer) ||
        (processContainer && !fitsProcessContainer)
      ) ? 1 : 0,
      artifactExpansion(candidate.rect, extents),
      candidate.sideRank,
      Math.abs(candidate.offset),
      candidate.gap,
      candidate.rect.y,
      candidate.rect.x
    ];

    if (!best || compareScores(score, best.score) < 0) {
      best = { candidate: candidate.rect, score };
    }
  }

  if (best) {
    return best.candidate;
  }

  throw new LayoutError(
    'ARTIFACT_PLACEMENT_FAILED',
    artifact.id,
    `No collision-free artifact position could be found (${artifact.id}).`
  );
}

function ownedArtifactCandidates(artifact, owner, sizes) {
  const candidates = [];
  const preferredSides = is(artifact, 'bpmn:DataObjectReference')
    ? [ 'below', 'right', 'left', 'above' ]
    : [ 'above', 'left', 'right', 'below' ];
  const offsets = [ 0 ];

  for (let distance = ROUTING_MARGIN; distance <= MAX_ARTIFACT_SEARCH_OFFSET; distance += ROUTING_MARGIN) {
    offsets.push(distance, -distance);
  }

  for (const size of sizes) {
    for (let sideRank = 0; sideRank < preferredSides.length; sideRank++) {
      const side = preferredSides[sideRank];

      for (let gap = ROUTING_MARGIN; gap <= MAX_ARTIFACT_GAP_STEPS * ROUTING_MARGIN; gap += ROUTING_MARGIN) {
        for (const offset of offsets) {
          candidates.push({
            rect: artifactBoundsAt(owner, size, side, gap, offset),
            sideRank,
            offset,
            gap
          });
        }
      }
    }
  }

  return candidates;
}

function artifactBoundsAt(owner, size, side, gap, offset) {
  if (side === 'above') {
    return bounds(
      owner.x + (owner.width - size.width) / 2 + offset,
      owner.y - gap - size.height,
      size.width,
      size.height
    );
  }
  if (side === 'below') {
    return bounds(
      owner.x + (owner.width - size.width) / 2 + offset,
      owner.y + owner.height + gap,
      size.width,
      size.height
    );
  }
  if (side === 'left') {
    return bounds(
      owner.x - gap - size.width,
      owner.y + (owner.height - size.height) / 2 + offset,
      size.width,
      size.height
    );
  }

  return bounds(
    owner.x + owner.width + gap,
    owner.y + (owner.height - size.height) / 2 + offset,
    size.width,
    size.height
  );
}

function artifactClearanceBounds(artifact, rect, clearance) {
  if (!clearance || !is(artifact, 'bpmn:TextAnnotation')) {
    return rect;
  }

  return bounds(
    rect.x - clearance,
    rect.y - clearance,
    rect.width + 2 * clearance,
    rect.height + 2 * clearance
  );
}

function unownedArtifactCandidates(sizes, extents) {
  const candidates = [];

  for (const size of sizes) {
    for (let offset = 0; offset <= extents.width + size.width; offset += ROUTING_MARGIN) {
      candidates.push({
        rect: bounds(
          extents.minX + offset,
          extents.minY - VERTICAL_GAP - size.height,
          size.width,
          size.height
        ),
        sideRank: 0,
        offset,
        gap: VERTICAL_GAP
      });
    }
  }

  return candidates;
}

function outerScopeArtifactCandidates(sizes, extents) {
  const candidates = [];

  for (const size of sizes) {
    const horizontalPositions = axisPositions(
      extents.minX,
      extents.maxX - size.width
    );
    const verticalPositions = axisPositions(
      extents.minY,
      extents.maxY - size.height
    );

    for (const x of horizontalPositions) {
      candidates.push({
        rect: bounds(
          x,
          extents.minY - ROUTING_MARGIN - size.height,
          size.width,
          size.height
        ),
        sideRank: 4,
        offset: 0,
        gap: ROUTING_MARGIN
      });
      candidates.push({
        rect: bounds(
          x,
          extents.maxY + ROUTING_MARGIN,
          size.width,
          size.height
        ),
        sideRank: 4,
        offset: 0,
        gap: ROUTING_MARGIN
      });
    }

    for (const y of verticalPositions) {
      candidates.push({
        rect: bounds(
          extents.minX - ROUTING_MARGIN - size.width,
          y,
          size.width,
          size.height
        ),
        sideRank: 4,
        offset: 0,
        gap: ROUTING_MARGIN
      });
      candidates.push({
        rect: bounds(
          extents.maxX + ROUTING_MARGIN,
          y,
          size.width,
          size.height
        ),
        sideRank: 4,
        offset: 0,
        gap: ROUTING_MARGIN
      });
    }
  }

  return candidates;
}

function axisPositions(min, max) {
  if (max <= min) {
    return [ Math.round((min + max) / 2) ];
  }

  const positions = [];

  for (let position = min; position <= max; position += ROUTING_MARGIN) {
    positions.push(position);
  }

  if (positions.at(-1) !== max) {
    positions.push(max);
  }

  return positions;
}

function artifactFitsContainer(candidate, container, margin = ROUTING_MARGIN) {
  return !container ||
    candidate.x >= container.x + margin &&
    candidate.y >= container.y + margin &&
    candidate.x + candidate.width <=
      container.x + container.width - margin &&
    candidate.y + candidate.height <=
      container.y + container.height - margin;
}

function artifactObstacleBounds(rect) {
  return {
    x: rect.x - BOUNDARY_EVENT_ARTIFACT_CLEARANCE,
    y: rect.y - BOUNDARY_EVENT_ARTIFACT_CLEARANCE,
    width: rect.width + 2 * BOUNDARY_EVENT_ARTIFACT_CLEARANCE,
    height: rect.height + 2 * BOUNDARY_EVENT_ARTIFACT_CLEARANCE
  };
}

function artifactIntersectsRoutes(rect, routeSegments) {
  const clearance = {
    x: rect.x - ROUTING_MARGIN / 2,
    y: rect.y - ROUTING_MARGIN / 2,
    width: rect.width + ROUTING_MARGIN,
    height: rect.height + ROUTING_MARGIN
  };

  return routeSegments.some(([ start, end ]) => {
    return segmentEntersRect(start, end, clearance);
  });
}

function routeCrossings(points, routeSegments) {
  return toSegments(points).reduce((total, [ start, end ]) => {
    return total + routeSegments.filter(([ a, b ]) => {
      return segmentsProperlyCross(start, end, a, b);
    }).length;
  }, 0);
}

function artifactExpansion(rect, extents) {
  return Math.max(0, extents.minX - rect.x) +
    Math.max(0, extents.minY - rect.y) +
    Math.max(0, rect.x + rect.width - extents.maxX) +
    Math.max(0, rect.y + rect.height - extents.maxY);
}

function isStraightOrthogonalRoute(points) {
  return points.every(({ x }) => x === points[0].x) ||
    points.every(({ y }) => y === points[0].y);
}

export function routeArtifactAssociation(
    association,
    owner,
    ownerBounds,
    artifact,
    artifactBounds) {
  return associationConnection(
    association,
    owner,
    ownerBounds,
    artifact,
    artifactBounds
  );
}
