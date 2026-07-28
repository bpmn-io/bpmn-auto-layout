import { is } from '../../di/DiUtil.js';
import { LayoutError } from '../../LayoutError.js';
import {
  BOUNDARY_EVENT_ARTIFACT_CLEARANCE,
  EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE,
  NON_STRAIGHT_ARTIFACT_ASSOCIATION_PENALTY,
  PARTICIPANT_HEADER_WIDTH,
  ROUTING_MARGIN,
  SUB_PROCESS_PADDING,
  VERTICAL_GAP
} from '../Constants.js';
import { isExteriorArtifact } from '../bpmn/Predicates.js';
import {
  bounds,
  rectanglesOverlap,
  routeLength,
  segmentEntersRect,
  toSegments
} from '../geometry/index.js';
import { pathIsClear } from '../process/routing/SequenceFlowRouting.js';
import {
  artifactAssociationConnection,
  routeCrossings
} from './AssociationRouting.js';
import { findContainingArtifactContainers } from './Ownership.js';
import {
  annotationSizePenalty,
  artifactClearanceBounds,
  artifactSizeCandidates,
  createArtifactPlacementCandidates
} from './PlacementCandidates.js';
import {
  artifactCongestionPenalty,
  artifactExpansion,
  artifactIsAligned,
  compareArtifactPlacementScores,
  createArtifactPlacementScore,
  isStraightOrthogonalRoute,
  ownerBalancedRouteLength
} from './PlacementScoring.js';

export function placeArtifactRecords(context) {
  const {
    additionalBoundaryContainers,
    artifactRecords,
    avoidParticipantInterior,
    graphExtents,
    graphObstacles,
    graphRoutes,
    graphShapes,
    layout,
    obstaclesByArtifact,
    owners,
    placedArtifacts,
    placementExtents,
    preferParticipantSides,
    reservedVerticalEndpointDirections
  } = context;

  artifactRecords.sort((a, b) => {
    const aReferences = owners.get(a.element)?.length || 0;
    const bReferences = owners.get(b.element)?.length || 0;
    const aArea = artifactSizeCandidates(a.element)[0];
    const bArea = artifactSizeCandidates(b.element)[0];

    return bReferences - aReferences ||
      bArea.width * bArea.height - aArea.width * aArea.height ||
      a.index - b.index;
  });

  for (const record of artifactRecords) {
    const references = owners.get(record.element) || [];
    const ownerBounds = references.length
      ? graphShapes.get(references[0].owner)
      : null;
    const owner = references[0]?.owner;
    const enclosingSubProcesses = ownerBounds
      ? [ ...graphShapes.entries() ].filter(([ element, rect ]) => {
        const centerX = ownerBounds.x + ownerBounds.width / 2;
        const centerY = ownerBounds.y + ownerBounds.height / 2;

        return element !== owner &&
          is(element, 'bpmn:SubProcess') &&
          centerX >= rect.x &&
          centerX <= rect.x + rect.width &&
          centerY >= rect.y &&
          centerY <= rect.y + rect.height;
      })
      : [];
    const subProcessContainer = enclosingSubProcesses
      .map(([ , rect ]) => rect)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    const containingContainers = ownerBounds
      ? findContainingArtifactContainers(ownerBounds, graphShapes)
      : [];
    const container = containingContainers[0];
    const boundaryContainers = [
      ...additionalBoundaryContainers,
      ...[ ...graphShapes.entries() ]
        .filter(([ element ]) => {
          return is(element, 'bpmn:Lane') ||
            is(element, 'bpmn:Participant') ||
            is(element, 'bpmn:SubProcess');
        })
        .map(([ element, rect ]) => ({
          rect,
          containsOwner: containingContainers.includes(rect),
          participant: is(element, 'bpmn:Participant')
        }))
    ];
    const processContainer = subProcessContainer || (
      !container && isExteriorArtifact(record.element)
        ? bounds(
          graphExtents.minX - SUB_PROCESS_PADDING,
          graphExtents.minY - SUB_PROCESS_PADDING,
          graphExtents.width + 2 * SUB_PROCESS_PADDING,
          graphExtents.height + 2 * SUB_PROCESS_PADDING
        )
        : null
    );
    const annotationClearance = subProcessContainer &&
      is(record.element, 'bpmn:TextAnnotation')
      ? EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE
      : 0;
    const obstacles = graphObstacles.filter(({ element }) => {
      return !enclosingSubProcesses.some(([ subProcess ]) => {
        return subProcess === element;
      });
    });
    obstaclesByArtifact.set(record.element, obstacles);
    const placement = findArtifactPlacement(
      record.element,
      {
        ownerBounds,
        references,
        sizes: artifactSizeCandidates(record.element),
        obstacles,
        routes: graphRoutes,
        occupied: placedArtifacts,
        container,
        processContainer,
        extents: placementExtents,
        annotationClearance,
        boundaryContainers,
        avoidParticipantInterior,
        preferParticipantSides,
        participantInteriorPreference: (
          isExteriorArtifact(record.element) &&
          references.some(({ owner }) => {
            return reservedVerticalEndpointDirections.has(owner);
          })
        ) ? VERTICAL_GAP : 0
      }
    );

    layout.shapes.set(record.element, placement);
    placedArtifacts.push({
      element: record.element,
      rect: placement,
      annotationClearance
    });
  }
}

function findArtifactPlacement(
    artifact,
    {
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
      boundaryContainers = [],
      avoidParticipantInterior = false,
      preferParticipantSides = true,
      participantInteriorPreference = 0
    }) {
  const preparedBoundaryContainers = boundaryContainers.map(({
    rect,
    containsOwner,
    participant
  }) => {
    return {
      containsOwner,
      participant,
      rect,
      headerRect: participant && {
        x: rect.x,
        y: rect.y,
        width: PARTICIPANT_HEADER_WIDTH,
        height: rect.height
      }
    };
  });
  const referenceOwnerBounds = [ ...new Set(
    references.map(reference => reference.ownerBounds).filter(Boolean)
  ) ];
  const hasMultipleOwners = referenceOwnerBounds.length > 1;
  const candidates = createArtifactPlacementCandidates(
    artifact,
    ownerBounds,
    referenceOwnerBounds,
    sizes,
    preparedBoundaryContainers,
    annotationClearance,
    extents
  );
  const obstacleBounds = obstacles.map(({ element, rect }) => {
    return is(element, 'bpmn:BoundaryEvent')
      ? artifactObstacleBounds(rect)
      : rect;
  });
  const occupiedBounds = occupied.map(({ element, rect, annotationClearance }) => {
    return artifactClearanceBounds(element, rect, annotationClearance);
  });
  const routeSegments = routes.flatMap(route => toSegments(route.points));
  const dataArtifact = is(artifact, 'bpmn:DataObjectReference') ||
    is(artifact, 'bpmn:DataStoreReference');
  const requiresContainment = is(artifact, 'bpmn:DataObjectReference');
  const rankedCandidates = candidates.map(candidate => {
    const routedReferences = references.map(({
      association,
      owner,
      ownerBounds,
      ownerConnectionIndex,
      ownerConnectionCount
    }) => {
      const points = ownerBounds && artifactAssociationConnection(
        association,
        owner,
        ownerBounds,
        artifact,
        candidate.rect,
        ownerConnectionIndex,
        ownerConnectionCount,
        obstacles,
        routeSegments
      );
      return points && { owner, points };
    }).filter(Boolean);
    const directLength = dataArtifact
      ? ownerBalancedRouteLength(routedReferences)
      : routedReferences.reduce((total, { points }) => {
        return total + routeLength(points);
      }, 0);
    const associationCrossingCount = routedReferences.reduce((total, { points }) => {
      return total + routeCrossings(points, routeSegments);
    }, 0);
    const associationBendCount = dataArtifact
      ? routedReferences.reduce((total, { points }) => {
        return total + Math.max(0, points.length - 2);
      }, 0)
      : 0;
    const alignedOwnerCount = dataArtifact
      ? referenceOwnerBounds.filter(referenceBounds => {
        return artifactIsAligned(candidate.rect, referenceBounds);
      }).length
      : 0;
    const missesOwnerAlignment = dataArtifact &&
      referenceOwnerBounds.length > 0 &&
      alignedOwnerCount === 0 ? 1 : 0;
    const congestionPenalty = hasMultipleOwners
      ? artifactCongestionPenalty(candidate.rect, obstacleBounds)
      : 0;
    const congestionViolation = congestionPenalty > 0 ? 1 : 0;
    const participantInteriorPenalty = (
      avoidParticipantInterior ||
      participantInteriorPreference
    ) &&
      is(artifact, 'bpmn:TextAnnotation') &&
      preparedBoundaryContainers.some(({
        rect,
        containsOwner,
        participant
      }) => {
        return participant &&
          containsOwner &&
          artifactFitsContainer(candidate.rect, rect, 0);
      }) ? 1 : 0;
    const participantVerticalSidePenalty = preferParticipantSides &&
      is(artifact, 'bpmn:TextAnnotation') &&
      preparedBoundaryContainers.some(({
        rect,
        containsOwner,
        participant
      }) => {
        return participant &&
          containsOwner &&
          (
            candidate.rect.y + candidate.rect.height <= rect.y ||
            candidate.rect.y >= rect.y + rect.height
          );
      }) ? 1 : 0;
    const lowerBound = createArtifactPlacementScore({
      participantInteriorViolation:
        avoidParticipantInterior ? participantInteriorPenalty : 0,
      dataCrossings: dataArtifact ? associationCrossingCount : 0,
      congestionViolation,
      missesOwnerAlignment,
      alignedOwnerReward: -alignedOwnerCount,
      associationBends: associationBendCount,
      weightedLength: directLength +
        congestionPenalty +
        participantInteriorPenalty * participantInteriorPreference +
        participantVerticalSidePenalty * 4 * VERTICAL_GAP,
      associationLength: directLength,
      annotationSize: is(artifact, 'bpmn:TextAnnotation')
        ? annotationSizePenalty(candidate.rect)
        : 0,
      annotationCrossings: dataArtifact ? 0 : associationCrossingCount,
      containmentViolation: 0,
      expansion: artifactExpansion(candidate.rect, extents),
      sideRank: candidate.sideRank,
      offset: Math.abs(candidate.offset),
      gap: candidate.gap,
      y: candidate.rect.y,
      x: candidate.rect.x
    });

    return {
      candidate,
      lowerBound,
      alignedOwnerCount,
      associationBendCount,
      associationCrossingCount,
      congestionPenalty,
      congestionViolation,
      missesOwnerAlignment,
      participantInteriorPenalty,
      participantVerticalSidePenalty,
      routedReferences
    };
  }).sort((a, b) => {
    return compareArtifactPlacementScores(a.lowerBound, b.lowerBound);
  });

  let best;

  for (const {
    candidate,
    lowerBound,
    alignedOwnerCount,
    associationBendCount,
    associationCrossingCount,
    congestionPenalty,
    congestionViolation,
    missesOwnerAlignment,
    participantInteriorPenalty,
    participantVerticalSidePenalty,
    routedReferences
  } of rankedCandidates) {
    if (best && compareArtifactPlacementScores(lowerBound, best.score) >= 0) {
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
    const violatesContainerBoundary = preparedBoundaryContainers.some(({
      rect,
      containsOwner,
      participant,
      headerRect
    }) => {
      if (participant && rectanglesOverlap(candidateBounds, headerRect)) {
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
        obstacleBounds.some(obstacle => {
          return rectanglesOverlap(candidateBounds, obstacle);
        }) ||
        occupiedBounds.some(occupied => {
          return rectanglesOverlap(candidateBounds, occupied);
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
    const associationLength = dataArtifact
      ? ownerBalancedRouteLength(routedReferences)
      : associationRoutes.reduce((total, points) => {
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
    const score = createArtifactPlacementScore({
      participantInteriorViolation:
        avoidParticipantInterior ? participantInteriorPenalty : 0,
      dataCrossings: dataArtifact ? associationCrossingCount : 0,
      congestionViolation,
      missesOwnerAlignment,
      alignedOwnerReward: -alignedOwnerCount,
      associationBends: associationBendCount,
      weightedLength: associationLength +
        congestionPenalty +
        nonStraightPenalty +
        participantInteriorPenalty * participantInteriorPreference +
        participantVerticalSidePenalty * 4 * VERTICAL_GAP,
      associationLength,
      annotationSize: is(artifact, 'bpmn:TextAnnotation')
        ? annotationSizePenalty(candidate.rect)
        : 0,
      annotationCrossings: dataArtifact ? 0 : associationCrossingCount,
      containmentViolation: !is(artifact, 'bpmn:TextAnnotation') && (
        (container && !fitsContainer) ||
        (processContainer && !fitsProcessContainer)
      ) ? 1 : 0,
      expansion: artifactExpansion(candidate.rect, extents),
      sideRank: candidate.sideRank,
      offset: Math.abs(candidate.offset),
      gap: candidate.gap,
      y: candidate.rect.y,
      x: candidate.rect.x
    });

    if (!best || compareArtifactPlacementScores(score, best.score) < 0) {
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
