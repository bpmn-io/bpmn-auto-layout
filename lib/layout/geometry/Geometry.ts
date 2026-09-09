import { SEGMENT_INTERSECTION_EPSILON } from '../Constants.js';

import type {
  Point,
  Rect
} from 'diagram-js/lib/util/Types.js';

export type Extents = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type Segment = [ Point, Point ];

export function bounds(
    x: number,
    y: number,
    width: number,
    height: number
): Rect {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

export function point(x: number, y: number): Point {
  return { x: Math.round(x), y: Math.round(y) };
}

export function rectanglesOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
}

export function integerBounds(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

export function getShapeExtents(
    shapes: Array<{ rect: Rect }>
): Extents {
  if (!shapes.length) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0
    };
  }

  const minX = Math.min(...shapes.map(({ rect }) => rect.x));
  const minY = Math.min(...shapes.map(({ rect }) => rect.y));
  const maxX = Math.max(...shapes.map(({ rect }) => rect.x + rect.width));
  const maxY = Math.max(...shapes.map(({ rect }) => rect.y + rect.height));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function directConnection(source: Rect, target: Rect): Point[] {
  const sourceCenter = point(
    source.x + source.width / 2,
    source.y + source.height / 2
  );
  const targetCenter = point(
    target.x + target.width / 2,
    target.y + target.height / 2
  );

  return [ sourceCenter, targetCenter ];
}

export function compareScores(a: number[], b: number[]): number {
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
}

export function routeLength(points: Point[]): number {
  return toSegments(points).reduce((total, [ start, end ]) => {
    return total + manhattan(start, end);
  }, 0);
}

export function cleanPoints(points: Point[]): Point[] {
  const cleaned: Point[] = [];

  for (const candidate of points) {
    const previous = cleaned.at(-1);

    if (
      !previous ||
      previous.x !== candidate.x ||
      previous.y !== candidate.y
    ) {
      cleaned.push(candidate);
    }

    while (cleaned.length >= 3) {
      const next = cleaned.at(-1);
      const middle = cleaned.at(-2);
      const before = cleaned.at(-3);

      if (!before || !middle || !next) {
        break;
      }
      const collinear =
        (before.x - middle.x) * (next.y - middle.y) ===
        (before.y - middle.y) * (next.x - middle.x);

      if (!collinear) {
        break;
      }

      cleaned.splice(-2, 1);

      if (before.x === next.x && before.y === next.y) {
        cleaned.pop();
      }
    }
  }

  return cleaned.map(candidate => point(candidate.x, candidate.y));
}

export function toSegments(points: Point[]): Segment[] {
  return points.slice(1).map((end, index) => [ points[index], end ]);
}

export function pointInRect(candidate: Point, rect: Rect): boolean {
  return candidate.x > rect.x && candidate.x < rect.x + rect.width &&
    candidate.y > rect.y && candidate.y < rect.y + rect.height;
}

export function inset(rect: Rect, margin: number): Rect {
  return {
    x: rect.x + margin,
    y: rect.y + margin,
    width: rect.width - 2 * margin,
    height: rect.height - 2 * margin
  };
}

export function segmentEntersRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edgeDirections = [ -dx, dx, -dy, dy ];
  const edgeDistances = [
    a.x - rect.x,
    rect.x + rect.width - a.x,
    a.y - rect.y,
    rect.y + rect.height - a.y
  ];
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

export function collinearOverlap(
    a: Point,
    b: Point,
    c: Point,
    d: Point
): boolean {
  const horizontal = a.y === b.y && c.y === d.y && a.y === c.y;
  const vertical = a.x === b.x && c.x === d.x && a.x === c.x;

  if (!horizontal && !vertical) {
    return false;
  }

  const [ aStart, aEnd, cStart, cEnd ] = horizontal
    ? [
      Math.min(a.x, b.x),
      Math.max(a.x, b.x),
      Math.min(c.x, d.x),
      Math.max(c.x, d.x)
    ]
    : [
      Math.min(a.y, b.y),
      Math.max(a.y, b.y),
      Math.min(c.y, d.y),
      Math.max(c.y, d.y)
    ];

  return Math.min(aEnd, cEnd) - Math.max(aStart, cStart) > 0;
}

// Two axis-aligned segments run parallel and close enough to read as one line:
// same orientation, overlapping along their shared axis, and separated on the
// perpendicular axis by a positive distance strictly below `separation`.
// Exact collinearity (zero separation) is intentionally excluded — that case is
// covered by `collinearOverlap` — so this only catches near-parallel lanes.
export function parallelProximityOverlap(
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    separation: number
): boolean {
  const horizontal = a.y === b.y && c.y === d.y;
  const vertical = a.x === b.x && c.x === d.x;

  if (!horizontal && !vertical) {
    return false;
  }

  const gap = horizontal
    ? Math.abs(a.y - c.y)
    : Math.abs(a.x - c.x);

  if (gap === 0 || gap >= separation) {
    return false;
  }

  const [ aStart, aEnd, cStart, cEnd ] = horizontal
    ? [
      Math.min(a.x, b.x),
      Math.max(a.x, b.x),
      Math.min(c.x, d.x),
      Math.max(c.x, d.x)
    ]
    : [
      Math.min(a.y, b.y),
      Math.max(a.y, b.y),
      Math.min(c.y, d.y),
      Math.max(c.y, d.y)
    ];

  return Math.min(aEnd, cEnd) - Math.max(aStart, cStart) > 0;
}

export function segmentsProperlyCross(
    a: Point,
    b: Point,
    c: Point,
    d: Point
): boolean {
  const abC = segmentDirection(a, b, c);
  const abD = segmentDirection(a, b, d);
  const cdA = segmentDirection(c, d, a);
  const cdB = segmentDirection(c, d, b);

  return abC * abD < 0 && cdA * cdB < 0;
}

export function segmentDirection(a: Point, b: Point, c: Point): number {
  return Math.sign(
    (b.x - a.x) * (c.y - a.y) -
    (b.y - a.y) * (c.x - a.x)
  );
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
