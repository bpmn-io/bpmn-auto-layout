import {
  ROUTE_OBSTACLE_INSET,
  ROUTING_MARGIN,
  VISIBILITY_GRAPH_TURN_PENALTY
} from '../Constants.js';
import {
  cleanPoints,
  collinearOverlap,
  getShapeExtents,
  inset,
  manhattan,
  parallelProximityOverlap,
  point,
  pointInRect,
  segmentEntersRect,
  segmentsProperlyCross,
  toSegments
} from '../geometry/index.js';

import type {
  Point,
  Rect
} from 'diagram-js/lib/util/Types.js';
import type { Segment } from '../geometry/Geometry.js';

export type { Point, Rect };

export type RouterObstacle = {
  excluded?: boolean;
  rect: Rect;
};

export type RouterRoute = {
  allowCollinearOverlap?: boolean;
  points: Point[];
};

export type OrthogonalRouterOptions = {
  obstacles?: RouterObstacle[];
  routes?: RouterRoute[];
  obstacleInset?: number;
  allowPerpendicularCrossings?: boolean;
  minParallelSeparation?: number;
  maxVisibilityPoints?: number;
};

export type OrthogonalRouter = {
  findRoute(start: Point, end: Point): Point[] | null;
  isClear(points: Point[]): boolean;
  isSegmentClear(a: Point, b: Point): boolean;
};

type RouterObstacleSnapshot = {
  excluded: boolean;
  rect: Rect;
};

type RouterRouteSnapshot = {
  allowCollinearOverlap: boolean;
  points: Point[];
};

type AllocatedSegment = {
  allowCollinearOverlap: boolean;
  end: Segment[1];
  start: Segment[0];
};

type VisibilityPointIndexes = {
  pointsByX: Map<number, number[]>;
  pointsByY: Map<number, number[]>;
};

type VisibilityNode = {
  distance: number;
  index: number;
};

const RECT_COORDINATE_KEYS: readonly (keyof Rect)[] = [
  'x',
  'y',
  'width',
  'height'
];

export function createOrthogonalRouter({
  obstacles = [],
  routes = [],
  obstacleInset = ROUTE_OBSTACLE_INSET,
  allowPerpendicularCrossings = false,
  minParallelSeparation = 0,
  maxVisibilityPoints = Infinity
}: OrthogonalRouterOptions = {}): OrthogonalRouter {
  validateRouterOptions(
    obstacles,
    routes,
    obstacleInset,
    allowPerpendicularCrossings,
    minParallelSeparation,
    maxVisibilityPoints
  );

  const obstacleSnapshots = obstacles.map(snapshotObstacle);
  const routeSnapshots = routes.map(snapshotRoute);
  const collisionObstacles: Rect[] = obstacleSnapshots
    .filter(({ excluded }) => !excluded)
    .map(({ rect }) => inset(rect, obstacleInset));
  const allocatedSegments: AllocatedSegment[] = routeSnapshots.flatMap(route => {
    return toSegments(route.points).map(([ start, end ]) => ({
      allowCollinearOverlap: route.allowCollinearOverlap,
      end,
      start
    }));
  });

  function isSegmentClear(a: Point, b: Point): boolean {
    validatePoint(a, 'segment start');
    validatePoint(b, 'segment end');

    return segmentIsClear(a, b);
  }

  function segmentIsClear(a: Point, b: Point): boolean {
    if (a.x === b.x && a.y === b.y) {
      return false;
    }

    if (collisionObstacles.some(rect => segmentEntersRect(a, b, rect))) {
      return false;
    }

    return !allocatedSegments.some(segment => {
      if (
        !allowPerpendicularCrossings &&
        segmentsProperlyCross(a, b, segment.start, segment.end)
      ) {
        return true;
      }

      if (segment.allowCollinearOverlap) {
        return false;
      }

      return collinearOverlap(a, b, segment.start, segment.end) ||
        parallelProximityOverlap(
          a,
          b,
          segment.start,
          segment.end,
          minParallelSeparation
        );
    });
  }

  function isClear(points: Point[]): boolean {
    validatePoints(points, 'path');

    return toSegments(points).every(([ start, end ]) => {
      return segmentIsClear(start, end);
    });
  }

  function findRoute(start: Point, end: Point): Point[] | null {
    validatePoint(start, 'route start');
    validatePoint(end, 'route end');

    const extents = getShapeExtents(obstacleSnapshots);
    const xs = new Set([
      start.x,
      end.x,
      extents.minX - ROUTING_MARGIN,
      extents.maxX + ROUTING_MARGIN
    ]);
    const ys = new Set([
      start.y,
      end.y,
      extents.minY - ROUTING_MARGIN,
      extents.maxY + ROUTING_MARGIN
    ]);

    for (const { rect } of obstacleSnapshots) {
      xs.add(rect.x - ROUTING_MARGIN);
      xs.add(rect.x + rect.width + ROUTING_MARGIN);
      ys.add(rect.y - ROUTING_MARGIN);
      ys.add(rect.y + rect.height + ROUTING_MARGIN);
    }

    if (xs.size * ys.size > maxVisibilityPoints) {
      return null;
    }

    const points: Point[] = [];

    for (const x of xs) {
      for (const y of ys) {
        const candidate = point(x, y);

        if (!isInsideAny(candidate, obstacleSnapshots)) {
          points.push(candidate);
        }
      }
    }

    const startIndex = points.push(start) - 1;
    const endIndex = points.push(end) - 1;
    const { pointsByX, pointsByY } = indexVisibilityPoints(points);
    const distance = Array<number>(points.length).fill(Infinity);
    const previous = Array<number>(points.length).fill(-1);
    const pending = new Set<number>(points.map((_, index) => index));
    const queue: VisibilityNode[] = [];
    distance[startIndex] = 0;
    pushVisibilityNode(queue, { index: startIndex, distance: 0 });

    while (queue.length) {
      const entry = popVisibilityNode(queue);
      const current = entry.index;

      if (!pending.has(current) || entry.distance !== distance[current]) {
        continue;
      }

      pending.delete(current);

      if (current === endIndex) {
        break;
      }

      const vertical = pointsByX.get(points[current].x) || [];
      const horizontal = pointsByY.get(points[current].y) || [];
      let verticalIndex = 0;
      let horizontalIndex = 0;

      while (
        verticalIndex < vertical.length ||
        horizontalIndex < horizontal.length
      ) {
        const verticalNext = vertical[verticalIndex] ?? Infinity;
        const horizontalNext = horizontal[horizontalIndex] ?? Infinity;
        const next = Math.min(verticalNext, horizontalNext);

        if (verticalNext === next) {
          verticalIndex++;
        }

        if (horizontalNext === next) {
          horizontalIndex++;
        }

        if (!pending.has(next)) {
          continue;
        }

        if (!segmentIsClear(points[current], points[next])) {
          continue;
        }

        const candidate = distance[current] +
          manhattan(points[current], points[next]) +
          VISIBILITY_GRAPH_TURN_PENALTY;

        if (candidate < distance[next]) {
          distance[next] = candidate;
          previous[next] = current;
          pushVisibilityNode(queue, { index: next, distance: candidate });
        }
      }
    }

    if (distance[endIndex] === Infinity) {
      return null;
    }

    const route: Point[] = [];

    for (let current = endIndex; current !== -1; current = previous[current]) {
      route.unshift(points[current]);
    }

    return cleanPoints(route);
  }

  return Object.freeze({
    findRoute,
    isClear,
    isSegmentClear
  });
}

function snapshotObstacle(
    obstacle: RouterObstacle,
    index: number
): RouterObstacleSnapshot {
  if (!obstacle || typeof obstacle !== 'object') {
    throw new TypeError(`obstacles[${ index }] must be an object`);
  }

  const { excluded = false, rect } = obstacle;

  if (typeof excluded !== 'boolean') {
    throw new TypeError(`obstacles[${ index }].excluded must be a boolean`);
  }

  validateRect(rect, `obstacles[${ index }].rect`);

  return {
    excluded,
    rect: { ...rect }
  };
}

function snapshotRoute(route: RouterRoute, index: number): RouterRouteSnapshot {
  if (!route || typeof route !== 'object') {
    throw new TypeError(`routes[${ index }] must be an object`);
  }

  const {
    allowCollinearOverlap = false,
    points
  } = route;

  if (typeof allowCollinearOverlap !== 'boolean') {
    throw new TypeError(
      `routes[${ index }].allowCollinearOverlap must be a boolean`
    );
  }

  validatePoints(points, `routes[${ index }].points`);

  return {
    allowCollinearOverlap,
    points: points.map(candidate => ({ ...candidate }))
  };
}

function validateRouterOptions(
    obstacles: RouterObstacle[],
    routes: RouterRoute[],
    obstacleInset: number,
    allowPerpendicularCrossings: boolean,
    minParallelSeparation: number,
    maxVisibilityPoints: number
): void {
  if (!Array.isArray(obstacles)) {
    throw new TypeError('obstacles must be an array');
  }

  if (!Array.isArray(routes)) {
    throw new TypeError('routes must be an array');
  }

  if (!Number.isFinite(obstacleInset)) {
    throw new TypeError('obstacleInset must be finite');
  }

  if (typeof allowPerpendicularCrossings !== 'boolean') {
    throw new TypeError('allowPerpendicularCrossings must be a boolean');
  }

  if (!Number.isFinite(minParallelSeparation) || minParallelSeparation < 0) {
    throw new TypeError(
      'minParallelSeparation must be a non-negative finite number'
    );
  }

  if (
    maxVisibilityPoints !== Infinity &&
    (!Number.isFinite(maxVisibilityPoints) || maxVisibilityPoints < 0)
  ) {
    throw new TypeError(
      'maxVisibilityPoints must be a non-negative finite number or Infinity'
    );
  }
}

function validateRect(rect: Rect, name: string): void {
  if (!rect || typeof rect !== 'object') {
    throw new TypeError(`${ name } must be an object`);
  }

  for (const key of RECT_COORDINATE_KEYS) {
    if (!Number.isFinite(rect[key])) {
      throw new TypeError(`${ name }.${ key } must be finite`);
    }
  }
}

function validatePoints(points: Point[], name: string): void {
  if (!Array.isArray(points)) {
    throw new TypeError(`${ name } must be an array`);
  }

  points.forEach((candidate, index) => {
    validatePoint(candidate, `${ name }[${ index }]`);
  });
}

function validatePoint(candidate: Point, name: string): void {
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError(`${ name } must be an object`);
  }

  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
    throw new TypeError(`${ name } coordinates must be finite`);
  }
}

function indexVisibilityPoints(points: Point[]): VisibilityPointIndexes {
  const pointsByX = new Map<number, number[]>();
  const pointsByY = new Map<number, number[]>();

  points.forEach((candidate, index) => {
    if (!Number.isNaN(candidate.x)) {
      appendVisibilityPoint(pointsByX, candidate.x, index);
    }

    if (!Number.isNaN(candidate.y)) {
      appendVisibilityPoint(pointsByY, candidate.y, index);
    }
  });

  return { pointsByX, pointsByY };
}

function appendVisibilityPoint(
    index: Map<number, number[]>,
    coordinate: number,
    pointIndex: number
): void {
  const points = index.get(coordinate);

  if (points) {
    points.push(pointIndex);
  } else {
    index.set(coordinate, [ pointIndex ]);
  }
}

function pushVisibilityNode(queue: VisibilityNode[], entry: VisibilityNode): void {
  queue.push(entry);

  let index = queue.length - 1;

  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);

    if (compareVisibilityNodes(queue[parentIndex], entry) <= 0) {
      break;
    }

    queue[index] = queue[parentIndex];
    index = parentIndex;
  }

  queue[index] = entry;
}

function popVisibilityNode(queue: VisibilityNode[]): VisibilityNode {
  const first = queue[0];
  const last = queue.pop();

  if (queue.length && last) {
    let index = 0;

    while (index * 2 + 1 < queue.length) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      const childIndex = rightIndex < queue.length &&
        compareVisibilityNodes(queue[rightIndex], queue[leftIndex]) < 0
        ? rightIndex
        : leftIndex;

      if (compareVisibilityNodes(last, queue[childIndex]) <= 0) {
        break;
      }

      queue[index] = queue[childIndex];
      index = childIndex;
    }

    queue[index] = last;
  }

  return first;
}

function compareVisibilityNodes(a: VisibilityNode, b: VisibilityNode): number {
  return a.distance - b.distance || a.index - b.index;
}

function isInsideAny(
    candidate: Point,
    obstacles: RouterObstacleSnapshot[]
): boolean {
  return obstacles.some(({ excluded, rect }) => {
    return !excluded && pointInRect(candidate, rect);
  });
}
