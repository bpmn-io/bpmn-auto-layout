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
  FLOW_LABEL_INDENT,
  MAX_LABEL_SEARCH_STEPS,
  PARTICIPANT_HEADER_WIDTH,
  ROUTING_MARGIN
} from './Constants.js';
import {
  getExternalLabelText,
  isExternalLabelOwner
} from './BpmnUtil.js';
import {
  bounds,
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
      isContainer: isContainer(di)
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
    return preferredCandidates(label, shapeByElement)
      .filter(candidate => candidateIsClear(candidate, shapes, edges, []))
      .length;
  };

  labels.sort((a, b) => {
    return staticCandidateCount(a) - staticCandidateCount(b) ||
      b.size.width * b.size.height - a.size.width * a.size.height ||
      a.index - b.index;
  });

  for (const label of labels) {
    const preferred = preferredCandidates(label, shapeByElement);
    const defaultCandidate = preferred[0];
    const candidate = preferred.find(rect => {
      return candidateIsClear(rect, shapes, edges, occupied);
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

function preferredCandidates(label, shapeByElement) {
  if (label.points) {
    return connectionLabelCandidates(label);
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

function connectionLabelCandidates(label) {
  const segments = label.points.slice(0, -1).map((start, index) => ({
    start,
    end: label.points[index + 1],
    index
  })).filter(({ start, end }) => start.x !== end.x || start.y !== end.y);
  const middle = (segments.length - 1) / 2;

  segments.sort((a, b) => {
    return Math.abs(a.index - middle) - Math.abs(b.index - middle) ||
      a.index - b.index;
  });

  return segments.flatMap(segment => {
    return segmentLabelCandidates(segment.start, segment.end, label.size);
  });
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

  for (let step = 1; step <= MAX_LABEL_SEARCH_STEPS; step++) {
    for (let dx = -step; dx <= step; dx++) {
      const dy = step - Math.abs(dx);
      const offsets = dy ? [ dy, -dy ] : [ 0 ];

      for (const offsetY of offsets) {
        const candidate = bounds(
          preferred.x + dx * ROUTING_MARGIN,
          preferred.y + offsetY * ROUTING_MARGIN,
          label.size.width,
          label.size.height
        );

        if (candidateIsClear(candidate, shapes, edges, occupied)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

function candidateIsClear(candidate, shapes, edges, occupied) {
  const footprint = expand(candidate, EXTERNAL_LABEL_CLEARANCE);
  const edgeFootprint = expand(candidate, EXTERNAL_LABEL_CLEARANCE - 1);

  if (occupied.some(label => rectanglesOverlap(footprint, expand(label, EXTERNAL_LABEL_CLEARANCE)))) {
    return false;
  }

  for (const shape of shapes) {
    if (shape.isContainer) {
      if (straddles(candidate, shape.rect) ||
          overlapsParticipantHeader(candidate, shape)) {
        return false;
      }
    } else if (rectanglesOverlap(footprint, shape.rect)) {
      return false;
    }
  }

  return !edges.some(edge => {
    for (let index = 0; index < edge.points.length - 1; index++) {
      if (segmentEntersRect(edge.points[index], edge.points[index + 1], edgeFootprint)) {
        return true;
      }
    }

    return false;
  });
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

function expand(rect, margin) {
  return bounds(
    rect.x - margin,
    rect.y - margin,
    rect.width + 2 * margin,
    rect.height + 2 * margin
  );
}
