import { is } from '../di/DiUtil.js';
import { LayoutError } from '../LayoutError.js';
import {
  EXTERNAL_LABEL_CHARACTER_WIDTH,
  EXTERNAL_LABEL_CLEARANCE,
  EXTERNAL_LABEL_LINE_HEIGHT,
  EXTERNAL_LABEL_SPACE_WIDTH,
  EXTERNAL_LABEL_UPPERCASE_WIDTH,
  EXTERNAL_LABEL_WIDE_CHARACTER_WIDTH,
  EXTERNAL_LABEL_WIDTH,
  EXPANDED_SUBPROCESS_LABEL_HEIGHT,
  EXPANDED_SUBPROCESS_LABEL_PADDING,
  FLOW_LABEL_INDENT,
  MAX_LABEL_SEARCH_STEPS,
  PARTICIPANT_HEADER_WIDTH,
  ROUTING_MARGIN
} from './Constants.js';
import {
  getExternalLabelText,
  hasSubProcessLabel,
  isExternalLabelOwner
} from './BpmnUtil.js';
import {
  bounds,
  getExpandedChildEdges,
  getExpandedChildShapes,
  integerBounds,
  rectanglesOverlap,
  segmentEntersRect
} from './LayoutUtil.js';

export function layoutExternalLabels(factory, planeElements) {
  const shapes = planeElements
    .filter(element => element.$instanceOf('bpmndi:BPMNShape') && element.bounds)
    .map((di, index) => ({
      di,
      element: di.bpmnElement,
      rect: di.bounds,
      index,
      isContainer: isContainer(di),
      titleBounds: expandedSubProcessTitleBounds(
        di.bpmnElement,
        di.bounds,
        di.isExpanded === true
      )
    }));
  const edges = planeElements
    .filter(element => element.$instanceOf('bpmndi:BPMNEdge') && element.waypoint?.length > 1)
    .map((di, index) => ({
      di,
      element: di.bpmnElement,
      points: di.waypoint,
      index
    }));
  const shapeByElement = new Map(shapes.map(shape => [ shape.element, shape ]));
  const labels = [
    ...shapes.map(shape => labelRecord(shape, shape.index)),
    ...edges.map(edge => labelRecord(edge, shapes.length + edge.index))
  ].filter(Boolean);
  const occupied = [];

  const staticCandidateCount = label => {
    return preferredCandidates(label, shapeByElement, edges)
      .filter(candidate => candidateIsClear(candidate, label, shapes, edges, []))
      .length;
  };

  labels.sort((a, b) => {
    return staticCandidateCount(a) - staticCandidateCount(b) ||
      b.size.width * b.size.height - a.size.width * a.size.height ||
      a.index - b.index;
  });

  for (const label of labels) {
    const preferred = preferredCandidates(label, shapeByElement, edges);
    const defaultCandidate = preferred[0];
    const candidate = preferred.find(rect => {
      return candidateIsClear(rect, label, shapes, edges, occupied);
    }) || freeCandidate(label, defaultCandidate, shapes, edges, occupied);

    if (!candidate) {
      throw new LayoutError(
        'LABEL_PLACEMENT_FAILED',
        label.element.id,
        `No collision-free external label position could be found (${label.element.id}).`
      );
    }

    label.di.label = factory.createDiLabel(integerBounds(candidate));
    occupied.push(candidate);
  }
}

export function needsExpandedSubProcessTitleClearance(element, rect, childLayout) {
  const expandedElements = collectExpandedElements(childLayout);
  const shapes = [
    ...childLayout.shapes.entries(),
    ...getExpandedChildShapes(childLayout)
  ].map(([ childElement, childRect ], index) => {
    const expanded = expandedElements.has(childElement);

    return {
      element: childElement,
      rect: childRect,
      index,
      isContainer: expanded ||
        is(childElement, 'bpmn:Participant') ||
        is(childElement, 'bpmn:Lane'),
      titleBounds: expandedSubProcessTitleBounds(
        childElement,
        childRect,
        expanded
      )
    };
  });
  const container = {
    element,
    rect,
    isContainer: true,
    titleBounds: expandedSubProcessTitleBounds(element, rect, true)
  };
  const allShapes = [ container, ...shapes ];
  const edges = [
    ...childLayout.edges.entries(),
    ...getExpandedChildEdges(childLayout)
  ].map(([ childElement, points ], index) => ({
    element: childElement,
    points,
    index
  }));
  const shapeByElement = new Map(shapes.map(shape => [ shape.element, shape ]));
  const labels = [
    ...shapes.map(shape => labelRecord(shape, shape.index)),
    ...edges.map(edge => labelRecord(edge, shapes.length + edge.index))
  ].filter(Boolean);

  return labels.some(label => {
    const preferred = preferredCandidates(label, shapeByElement, edges);
    const hasClearPreferred = preferred.some(candidate => {
      return candidateIsClear(candidate, label, allShapes, edges, []);
    });
    const hasTitleBlockedPreferred = preferred.some(candidate => {
      return overlapsAnyContainerTitle(candidate, allShapes) &&
        candidateIsCollisionFree(
          candidate,
          allShapes,
          edges,
          [],
          true
        ) &&
        hasClearOwnerCorridor(candidate, label, allShapes);
    });

    return !hasClearPreferred && hasTitleBlockedPreferred;
  });
}

function collectExpandedElements(layout) {
  const elements = new Set();

  for (const child of layout.children) {
    if (!child.emitInParent) {
      continue;
    }

    elements.add(child.scope);

    for (const element of collectExpandedElements(child)) {
      elements.add(element);
    }
  }

  return elements;
}

function labelRecord(owner, index) {
  const element = owner.element;
  const text = isExternalLabelOwner(element)
    ? getExternalLabelText(element).trim()
    : '';

  if (!text) {
    return null;
  }

  return {
    ...owner,
    index,
    text,
    size: externalLabelSize(text)
  };
}

export function externalLabelSize(text) {
  const lines = text.trim().split(/\n/).reduce((total, paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let lineWidth = 0;
    let paragraphLines = 1;

    for (const word of words) {
      const chunks = wordChunks(word);

      for (let index = 0; index < chunks.length; index++) {
        const chunkWidth = chunks[index];
        const separator = lineWidth && index === 0
          ? EXTERNAL_LABEL_SPACE_WIDTH
          : 0;

        if (!lineWidth) {
          lineWidth = chunkWidth;
        } else if (index === 0 &&
            lineWidth + separator + chunkWidth <= EXTERNAL_LABEL_WIDTH) {
          lineWidth += separator + chunkWidth;
        } else {
          paragraphLines++;
          lineWidth = chunkWidth;
        }
      }
    }

    return total + paragraphLines;
  }, 0);

  return {
    width: EXTERNAL_LABEL_WIDTH,
    height: Math.max(EXTERNAL_LABEL_LINE_HEIGHT, lines * EXTERNAL_LABEL_LINE_HEIGHT)
  };
}

function wordChunks(word) {
  const chunks = [];
  let width = 0;

  for (const character of word) {
    const characterWidth = externalCharacterWidth(character);

    if (width && width + characterWidth > EXTERNAL_LABEL_WIDTH) {
      chunks.push(width);
      width = characterWidth;
    } else {
      width += characterWidth;
    }
  }

  if (width) {
    chunks.push(width);
  }

  return chunks;
}

function externalCharacterWidth(character) {
  if (/[MW]/.test(character)) {
    return EXTERNAL_LABEL_WIDE_CHARACTER_WIDTH;
  }
  if (/[mw]/.test(character)) {
    return EXTERNAL_LABEL_WIDE_CHARACTER_WIDTH - 1;
  }
  if (/[A-Z]/.test(character)) {
    return EXTERNAL_LABEL_UPPERCASE_WIDTH;
  }

  return EXTERNAL_LABEL_CHARACTER_WIDTH;
}

function preferredCandidates(label, shapeByElement, edges) {
  if (label.points) {
    return connectionLabelCandidates(label, edges);
  }

  const owner = shapeByElement.get(label.element);

  return owner ? shapeLabelCandidates(owner.rect, label.size) : [];
}

function shapeLabelCandidates(owner, size) {
  const centerX = owner.x + owner.width / 2;
  const centerY = owner.y + owner.height / 2;

  return [
    bounds(
      centerX - size.width / 2,
      owner.y + owner.height + EXTERNAL_LABEL_CLEARANCE,
      size.width,
      size.height
    ),
    bounds(
      centerX - size.width / 2,
      owner.y - EXTERNAL_LABEL_CLEARANCE - size.height,
      size.width,
      size.height
    ),
    bounds(
      owner.x - EXTERNAL_LABEL_CLEARANCE - size.width,
      centerY - size.height / 2,
      size.width,
      size.height
    ),
    bounds(
      owner.x + owner.width + EXTERNAL_LABEL_CLEARANCE,
      centerY - size.height / 2,
      size.width,
      size.height
    )
  ];
}

function connectionLabelCandidates(label, edges) {
  const segments = label.points.slice(0, -1).map((start, index) => ({
    start,
    end: label.points[index + 1],
    index
  })).filter(({ start, end }) => start.x !== end.x || start.y !== end.y);
  const middle = (segments.length - 1) / 2;
  const partitioned = segments.map(segment => {
    return partitionConnectionSegment(segment, label.element, edges);
  });
  const unique = partitioned.flatMap(parts => parts.unique);
  const shared = partitioned.flatMap(parts => parts.shared);

  const compare = (a, b) => {
    return Math.abs(a.index - middle) - Math.abs(b.index - middle) ||
      a.index - b.index ||
      a.centerOffset - b.centerOffset;
  };

  return [ ...unique.sort(compare), ...shared.sort(compare) ].flatMap(segment => {
    return segmentLabelCandidates(segment.start, segment.end, label.size);
  });
}

function partitionConnectionSegment(segment, owner, edges) {
  const horizontal = segment.start.y === segment.end.y;
  const vertical = segment.start.x === segment.end.x;

  if (!horizontal && !vertical) {
    return {
      unique: [ segmentPart(segment, segment.start, segment.end) ],
      shared: []
    };
  }

  const start = horizontal
    ? Math.min(segment.start.x, segment.end.x)
    : Math.min(segment.start.y, segment.end.y);
  const end = horizontal
    ? Math.max(segment.start.x, segment.end.x)
    : Math.max(segment.start.y, segment.end.y);
  const overlaps = [];

  for (const edge of edges) {
    if (edge.element === owner) {
      continue;
    }

    for (let index = 0; index < edge.points.length - 1; index++) {
      const otherStart = edge.points[index];
      const otherEnd = edge.points[index + 1];
      const collinear = horizontal
        ? otherStart.y === otherEnd.y && otherStart.y === segment.start.y
        : otherStart.x === otherEnd.x && otherStart.x === segment.start.x;

      if (!collinear) {
        continue;
      }

      const otherMin = horizontal
        ? Math.min(otherStart.x, otherEnd.x)
        : Math.min(otherStart.y, otherEnd.y);
      const otherMax = horizontal
        ? Math.max(otherStart.x, otherEnd.x)
        : Math.max(otherStart.y, otherEnd.y);
      const overlapStart = Math.max(start, otherMin);
      const overlapEnd = Math.min(end, otherMax);

      if (overlapEnd > overlapStart) {
        overlaps.push([ overlapStart, overlapEnd ]);
      }
    }
  }

  const merged = mergeIntervals(overlaps);
  const unique = [];
  const shared = [];
  let cursor = start;

  for (const [ overlapStart, overlapEnd ] of merged) {
    if (overlapStart > cursor) {
      unique.push(toSegmentPart(segment, cursor, overlapStart, horizontal));
    }

    shared.push(toSegmentPart(segment, overlapStart, overlapEnd, horizontal));
    cursor = overlapEnd;
  }

  if (cursor < end) {
    unique.push(toSegmentPart(segment, cursor, end, horizontal));
  }

  return { unique, shared };
}

function mergeIntervals(intervals) {
  const merged = [];

  for (const interval of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const previous = merged.at(-1);

    if (previous && interval[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      merged.push([ ...interval ]);
    }
  }

  return merged;
}

function toSegmentPart(segment, start, end, horizontal) {
  return segmentPart(
    segment,
    horizontal
      ? { x: start, y: segment.start.y }
      : { x: segment.start.x, y: start },
    horizontal
      ? { x: end, y: segment.start.y }
      : { x: segment.start.x, y: end }
  );
}

function segmentPart(segment, start, end) {
  const originalCenter = {
    x: (segment.start.x + segment.end.x) / 2,
    y: (segment.start.y + segment.end.y) / 2
  };
  const center = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };

  return {
    start,
    end,
    index: segment.index,
    centerOffset: Math.hypot(
      center.x - originalCenter.x,
      center.y - originalCenter.y
    )
  };
}

function segmentLabelCandidates(start, end, size) {
  const horizontal = start.y === end.y;
  const vertical = start.x === end.x;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const offsets = [ 0 ];

  for (let offset = ROUTING_MARGIN; offset <= length / 2; offset += ROUTING_MARGIN) {
    offsets.push(offset, -offset);
  }

  if (horizontal) {
    const centerX = (start.x + end.x) / 2;
    const gap = Math.max(
      EXTERNAL_LABEL_CLEARANCE,
      FLOW_LABEL_INDENT - size.height / 2
    );

    return offsets.flatMap(offset => [
      bounds(
        centerX + offset - size.width / 2,
        start.y - gap - size.height,
        size.width,
        size.height
      ),
      bounds(
        centerX + offset - size.width / 2,
        start.y + gap,
        size.width,
        size.height
      )
    ]);
  }

  if (vertical) {
    const centerY = (start.y + end.y) / 2;
    const gap = Math.max(
      EXTERNAL_LABEL_CLEARANCE,
      FLOW_LABEL_INDENT - size.width / 2
    );

    return offsets.flatMap(offset => [
      bounds(
        start.x + gap,
        centerY + offset - size.height / 2,
        size.width,
        size.height
      ),
      bounds(
        start.x - gap - size.width,
        centerY + offset - size.height / 2,
        size.width,
        size.height
      )
    ]);
  }

  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const normal = {
    x: -(end.y - start.y) / length,
    y: (end.x - start.x) / length
  };
  const distance = EXTERNAL_LABEL_CLEARANCE +
    Math.hypot(size.width, size.height) / 2;

  return [ 1, -1 ].map(direction => bounds(
    midpoint.x + normal.x * distance * direction - size.width / 2,
    midpoint.y + normal.y * distance * direction - size.height / 2,
    size.width,
    size.height
  ));
}

function freeCandidate(label, preferred, shapes, edges, occupied) {
  if (!preferred) {
    return null;
  }

  const candidates = [];
  let detachedFallback = false;

  for (let step = 1; step <= MAX_LABEL_SEARCH_STEPS; step++) {
    for (let dx = -step; dx <= step; dx++) {
      const dy = step - Math.abs(dx);
      const offsets = dy ? [ dy, -dy ] : [ 0 ];

      for (const offsetY of offsets) {
        const candidate = {
          rect: bounds(
            preferred.x + dx * ROUTING_MARGIN,
            preferred.y + offsetY * ROUTING_MARGIN,
            label.size.width,
            label.size.height
          ),
          displacement: step,
          index: candidates.length
        };

        candidates.push(candidate);

        if (!detachedFallback &&
            candidateIsCollisionFree(candidate.rect, shapes, edges, occupied)) {
          if (hasClearOwnerCorridor(candidate.rect, label, shapes)) {
            return candidate.rect;
          }

          detachedFallback = true;
        }
      }
    }
  }

  if (!detachedFallback) {
    return null;
  }

  for (const candidate of candidates) {
    candidate.ownerDistance = ownerAttachment(label, candidate.rect).distance;
  }

  candidates.sort((a, b) => {
    return a.ownerDistance - b.ownerDistance ||
      a.displacement - b.displacement ||
      a.index - b.index;
  });

  return candidates
    .map(candidate => candidate.rect)
    .find(candidate => {
      return candidateIsClear(candidate, label, shapes, edges, occupied);
    }) || null;
}

function candidateIsClear(candidate, label, shapes, edges, occupied) {
  return candidateIsCollisionFree(candidate, shapes, edges, occupied) &&
    hasClearOwnerCorridor(candidate, label, shapes);
}

function candidateIsCollisionFree(
    candidate,
    shapes,
    edges,
    occupied,
    ignoreContainerTitles = false) {
  const footprint = expand(candidate, EXTERNAL_LABEL_CLEARANCE);
  const edgeFootprint = expand(candidate, EXTERNAL_LABEL_CLEARANCE - 1);

  if (occupied.some(label => rectanglesOverlap(footprint, expand(label, EXTERNAL_LABEL_CLEARANCE)))) {
    return false;
  }

  for (const shape of shapes) {
    if (shape.isContainer) {
      if (straddles(candidate, shape.rect) ||
          overlapsParticipantHeader(candidate, shape) ||
          (!ignoreContainerTitles && overlapsContainerTitle(footprint, shape))) {
        return false;
      }
    } else if (rectanglesOverlap(footprint, shape.rect)) {
      return false;
    }
  }

  const intersectsEdge = edges.some(edge => {
    for (let index = 0; index < edge.points.length - 1; index++) {
      if (segmentEntersRect(edge.points[index], edge.points[index + 1], edgeFootprint)) {
        return true;
      }
    }

    return false;
  });

  return !intersectsEdge;
}

function overlapsAnyContainerTitle(candidate, shapes) {
  const footprint = expand(candidate, EXTERNAL_LABEL_CLEARANCE);

  return shapes.some(shape => {
    return shape.isContainer && overlapsContainerTitle(footprint, shape);
  });
}

function hasClearOwnerCorridor(candidate, label, shapes) {
  const attachment = ownerAttachment(label, candidate);

  return !shapes.some(shape => {
    return !shape.isContainer &&
      shape.element !== label.element &&
      segmentEntersRect(
        attachment.labelPoint,
        attachment.ownerPoint,
        shape.rect
      );
  });
}

function ownerAttachment(label, candidate) {
  if (label.rect) {
    return rectangleAttachment(candidate, label.rect);
  }

  return polylineAttachment(candidate, label.points);
}

function rectangleAttachment(candidate, owner) {
  const [ labelX, ownerX ] = closestAxisPoints(
    candidate.x,
    candidate.x + candidate.width,
    owner.x,
    owner.x + owner.width
  );
  const [ labelY, ownerY ] = closestAxisPoints(
    candidate.y,
    candidate.y + candidate.height,
    owner.y,
    owner.y + owner.height
  );

  return attachment(
    { x: labelX, y: labelY },
    { x: ownerX, y: ownerY }
  );
}

function closestAxisPoints(aStart, aEnd, bStart, bEnd) {
  if (aEnd < bStart) {
    return [ aEnd, bStart ];
  }
  if (bEnd < aStart) {
    return [ aStart, bEnd ];
  }

  const shared = (Math.max(aStart, bStart) + Math.min(aEnd, bEnd)) / 2;

  return [ shared, shared ];
}

function polylineAttachment(candidate, points) {
  let closest = null;

  for (let index = 0; index < points.length - 1; index++) {
    const current = segmentRectangleAttachment(
      candidate,
      points[index],
      points[index + 1]
    );

    if (!closest || current.distance < closest.distance) {
      closest = current;
    }
  }

  return closest;
}

function segmentRectangleAttachment(rect, start, end) {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ];
  const candidates = corners.map(labelPoint => {
    return attachment(labelPoint, closestPointOnSegment(labelPoint, start, end));
  });

  for (const ownerPoint of [ start, end ]) {
    candidates.push(attachment(
      closestPointInRectangle(ownerPoint, rect),
      ownerPoint
    ));
  }

  return candidates.reduce((closest, current) => {
    return current.distance < closest.distance ? current : closest;
  });
}

function closestPointOnSegment(candidate, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared
    ? Math.max(0, Math.min(1,
      ((candidate.x - start.x) * dx + (candidate.y - start.y) * dy) /
        lengthSquared
    ))
    : 0;

  return {
    x: start.x + ratio * dx,
    y: start.y + ratio * dy
  };
}

function closestPointInRectangle(candidate, rect) {
  return {
    x: Math.max(rect.x, Math.min(candidate.x, rect.x + rect.width)),
    y: Math.max(rect.y, Math.min(candidate.y, rect.y + rect.height))
  };
}

function attachment(labelPoint, ownerPoint) {
  return {
    labelPoint,
    ownerPoint,
    distance: Math.hypot(
      ownerPoint.x - labelPoint.x,
      ownerPoint.y - labelPoint.y
    )
  };
}

function isContainer(di) {
  return di.isExpanded === true ||
    is(di.bpmnElement, 'bpmn:Participant') ||
    is(di.bpmnElement, 'bpmn:Lane');
}

function straddles(candidate, container) {
  return rectanglesOverlap(candidate, container) &&
    !contains(container, candidate);
}

function contains(container, candidate) {
  return candidate.x >= container.x &&
    candidate.y >= container.y &&
    candidate.x + candidate.width <= container.x + container.width &&
    candidate.y + candidate.height <= container.y + container.height;
}

function overlapsParticipantHeader(candidate, shape) {
  if (!is(shape.element, 'bpmn:Participant')) {
    return false;
  }

  return rectanglesOverlap(candidate, bounds(
    shape.rect.x,
    shape.rect.y,
    PARTICIPANT_HEADER_WIDTH,
    shape.rect.height
  ));
}

function overlapsContainerTitle(candidate, shape) {
  if (!shape.titleBounds) {
    return false;
  }

  return rectanglesOverlap(candidate, shape.titleBounds);
}

function expandedSubProcessTitleBounds(element, rect, expanded) {
  if (!expanded || !hasSubProcessLabel(element)) {
    return null;
  }

  const maximumWidth = Math.max(
    0,
    rect.width - 2 * EXPANDED_SUBPROCESS_LABEL_PADDING
  );
  const textWidth = Math.max(...element.name.split('\n').map(line => {
    return [ ...line ].reduce((width, character) => {
      return width + (character === ' '
        ? EXTERNAL_LABEL_SPACE_WIDTH
        : externalCharacterWidth(character));
    }, 0);
  }));
  const width = Math.min(
    maximumWidth,
    textWidth + 2 * EXPANDED_SUBPROCESS_LABEL_PADDING
  );

  return bounds(
    rect.x + (rect.width - width) / 2,
    rect.y,
    width,
    EXPANDED_SUBPROCESS_LABEL_HEIGHT
  );
}

function expand(rect, margin) {
  return bounds(
    rect.x - margin,
    rect.y - margin,
    rect.width + 2 * margin,
    rect.height + 2 * margin
  );
}
