import { OUTER_MARGIN, SEGMENT_INTERSECTION_EPSILON } from './Constants.js';
import { isExteriorArtifact } from './BpmnUtil.js';

export function createLayout(scope) {
  return {
    scope,
    shapes: new Map(),
    edges: new Map(),
    children: [],
    emitInParent: false
  };
}

export function bounds(x, y, width, height) {
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function point(x, y) {
  return { x: Math.round(x), y: Math.round(y) };
}

export function rectanglesOverlap(a, b) {
  return a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
}

export function integerBounds(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

export function normalizeLayout(layout) {
  const extents = getShapeExtents([
    ...layout.shapes.entries(),
    ...getExpandedChildShapes(layout)
  ].map(([ element, rect ]) => ({ element, rect })));

  translateLayout(layout, OUTER_MARGIN - extents.minX, OUTER_MARGIN - extents.minY);
}

export function translateLayout(layout, dx, dy) {
  for (const rect of layout.shapes.values()) {
    rect.x += dx;
    rect.y += dy;
  }

  for (const points of layout.edges.values()) {
    for (const routePoint of points) {
      routePoint.x += dx;
      routePoint.y += dy;
    }
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      translateLayout(child, dx, dy);
    }
  }
}

export function getExtents(layout) {
  return getShapeExtents([ ...layout.shapes.entries() ].map(([ element, rect ]) => ({ element, rect })));
}

export function getParticipantContentExtents(layout) {
  return getShapeExtents([ ...layout.shapes.entries() ]
    .filter(([ element ]) => !isExteriorArtifact(element))
    .map(([ element, rect ]) => ({ element, rect })));
}

export function getShapeExtents(shapes) {
  if (!shapes.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...shapes.map(({ rect }) => rect.x));
  const minY = Math.min(...shapes.map(({ rect }) => rect.y));
  const maxX = Math.max(...shapes.map(({ rect }) => rect.x + rect.width));
  const maxY = Math.max(...shapes.map(({ rect }) => rect.y + rect.height));

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function getRecordExtents(records) {
  return getShapeExtents(records.map(record => ({ rect: record.bounds })));
}

export function getExpandedChildShapes(layout) {
  const shapes = [];

  for (const child of layout.children) {
    if (!child.emitInParent) {
      continue;
    }

    shapes.push(...child.shapes.entries());
    shapes.push(...getExpandedChildShapes(child));
  }

  return shapes;
}

export function getExpandedChildEdges(layout) {
  const edges = [];

  for (const child of layout.children) {
    if (!child.emitInParent) {
      continue;
    }

    edges.push(...child.edges.entries());
    edges.push(...getExpandedChildEdges(child));
  }

  return edges;
}

export function directConnection(source, target) {
  const sourceCenter = point(source.x + source.width / 2, source.y + source.height / 2);
  const targetCenter = point(target.x + target.width / 2, target.y + target.height / 2);

  return [ sourceCenter, targetCenter ];
}

export function compareScores(a, b) {
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
}

export function routeLength(points) {
  return toSegments(points).reduce((total, [ start, end ]) => {
    return total + manhattan(start, end);
  }, 0);
}

export function cleanPoints(points) {
  const unique = [];

  for (const candidate of points) {
    const previous = unique.at(-1);

    if (!previous || previous.x !== candidate.x || previous.y !== candidate.y) {
      unique.push(candidate);
    }
  }

  return unique.filter((candidate, index) => {
    const previous = unique[index - 1];
    const next = unique[index + 1];

    if (!previous || !next) {
      return true;
    }

    const collinear =
      (previous.x - candidate.x) * (next.y - candidate.y) ===
      (previous.y - candidate.y) * (next.x - candidate.x);
    const between =
      (candidate.x - previous.x) * (candidate.x - next.x) +
      (candidate.y - previous.y) * (candidate.y - next.y) <= 0;

    return !collinear || !between;
  }).map(candidate => point(candidate.x, candidate.y));
}

export function toSegments(points) {
  return points.slice(1).map((end, index) => [ points[index], end ]);
}

export function pointInRect(candidate, rect) {
  return candidate.x > rect.x && candidate.x < rect.x + rect.width &&
    candidate.y > rect.y && candidate.y < rect.y + rect.height;
}

export function inset(rect, margin) {
  return {
    x: rect.x + margin,
    y: rect.y + margin,
    width: rect.width - 2 * margin,
    height: rect.height - 2 * margin
  };
}

export function segmentEntersRect(a, b, rect) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edgeDirections = [ -dx, dx, -dy, dy ];
  const edgeDistances = [ a.x - rect.x, rect.x + rect.width - a.x, a.y - rect.y, rect.y + rect.height - a.y ];
  let start = 0;
  let end = 1;

  for (let index = 0; index < edgeDirections.length; index++) {
    if (edgeDirections[index] === 0) {
      if (edgeDistances[index] < 0) {
        return false;
      }
      continue;
    }

    const ratio = edgeDistances[index] / edgeDirections[index];

    if (edgeDirections[index] < 0) {
      if (ratio > end) {
        return false;
      }
      start = Math.max(start, ratio);
    } else {
      if (ratio < start) {
        return false;
      }
      end = Math.min(end, ratio);
    }
  }

  return end - start > SEGMENT_INTERSECTION_EPSILON;
}

export function collinearOverlap(a, b, c, d) {
  const horizontal = a.y === b.y && c.y === d.y && a.y === c.y;
  const vertical = a.x === b.x && c.x === d.x && a.x === c.x;

  if (!horizontal && !vertical) {
    return false;
  }

  const [ aStart, aEnd, cStart, cEnd ] = horizontal
    ? [ Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(c.x, d.x), Math.max(c.x, d.x) ]
    : [ Math.min(a.y, b.y), Math.max(a.y, b.y), Math.min(c.y, d.y), Math.max(c.y, d.y) ];

  return Math.min(aEnd, cEnd) - Math.max(aStart, cStart) > 0;
}

export function segmentsProperlyCross(a, b, c, d) {
  const abC = segmentDirection(a, b, c);
  const abD = segmentDirection(a, b, d);
  const cdA = segmentDirection(c, d, a);
  const cdB = segmentDirection(c, d, b);

  return abC * abD < 0 && cdA * cdB < 0;
}

export function segmentDirection(a, b, c) {
  return Math.sign(
    (b.x - a.x) * (c.y - a.y) -
    (b.y - a.y) * (c.x - a.x)
  );
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
