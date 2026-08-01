import {
  ROUTE_COLLISION_TOLERANCE,
  ROUTING_MARGIN,
  VISIBILITY_GRAPH_TURN_PENALTY
} from '../Constants.js';
import {
  cleanPoints,
  collinearOverlap,
  getShapeExtents,
  inset,
  manhattan,
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

export type RouterObstacleId = string | number | symbol | object;

export type RouterObstacle = {
  excluded?: boolean;
  id?: RouterObstacleId;
  rect: Rect;
};

export type RouterRoute = {
  allowCollinearOverlap?: boolean;
  points: Point[];
};

export type ConstrainedPathSection = {
  collisionTolerance?: number;
  exemptObstacleIds?: readonly RouterObstacleId[];
  obstacleOverrides?: readonly RouterObstacleOverride[];
  obstacleClearance: number;
  points: Point[];
};

export type RouterObstacleOverride = {
  collisionTolerance?: number;
  id: RouterObstacleId;
  obstacleClearance?: number;
};

export type ConstrainedPath = {
  sections: ConstrainedPathSection[];
};

export type OrthogonalRouterOptions = {
  obstacles?: RouterObstacle[];
  routes?: RouterRoute[];
  collisionTolerance?: number;
  obstacleClearance?: number;
  allowPerpendicularCrossings?: boolean;
  maxVisibilityPoints?: number;
};

export type RouteRequest = {
  end: Point;
  start: Point;
};

export type OrthogonalRouter = {
  findRoute(start: Point, end: Point): Point[] | null;
  findRoutes(requests: RouteRequest[]): (Point[] | null)[];
  isClear(points: Point[]): boolean;
  isPathClear(path: ConstrainedPath): boolean;
  isSegmentClear(a: Point, b: Point): boolean;
};

type RouterObstacleSnapshot = {
  excluded: boolean;
  id: RouterObstacleId;
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

type VisibilityEdge = {
  direction: 0 | 1;
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
  collisionTolerance = ROUTE_COLLISION_TOLERANCE,
  obstacleClearance = 0,
  allowPerpendicularCrossings = false,
  maxVisibilityPoints = Infinity
}: OrthogonalRouterOptions = {}): OrthogonalRouter {
  validateRouterOptions(
    obstacles,
    routes,
    collisionTolerance,
    obstacleClearance,
    allowPerpendicularCrossings,
    maxVisibilityPoints
  );

  const obstacleSnapshots = obstacles.map(snapshotObstacle);
  const routeSnapshots = routes.map(snapshotRoute);
  const obstacleIds = new Set(obstacleSnapshots.map(({ id }) => id));

  if (obstacleIds.size !== obstacleSnapshots.length) {
    throw new TypeError('obstacle ids must be unique');
  }

  const defaultCollisionInset = collisionTolerance - obstacleClearance;
  const collisionObstaclesByInset = new Map<
    number,
    Map<RouterObstacleId, RouterObstacleSnapshot>
  >();
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

  function segmentIsClear(
      a: Point,
      b: Point,
      collisionInset = defaultCollisionInset,
      exemptObstacleIds: ReadonlySet<RouterObstacleId> = new Set(),
      obstacleOverrides: ReadonlyMap<RouterObstacleId, number> = new Map()
  ): boolean {
    if (a.x === b.x && a.y === b.y) {
      return false;
    }

    const collisionObstacles = getCollisionObstacles(collisionInset);

    for (const { id, rect } of collisionObstacles.values()) {
      if (exemptObstacleIds.has(id)) {
        continue;
      }

      const overrideInset = obstacleOverrides.get(id);
      const collisionRect = overrideInset === undefined
        ? rect
        : getCollisionObstacles(overrideInset).get(id)?.rect;

      if (collisionRect && segmentEntersRect(a, b, collisionRect)) {
        return false;
      }
    }

    return !allocatedSegments.some(segment => {
      return (
        !allowPerpendicularCrossings &&
        segmentsProperlyCross(a, b, segment.start, segment.end)
      ) || (
        !segment.allowCollinearOverlap &&
        collinearOverlap(a, b, segment.start, segment.end)
      );
    });
  }

  function isClear(points: Point[]): boolean {
    validatePoints(points, 'path');

    return toSegments(points).every(([ start, end ]) => {
      return segmentIsClear(start, end);
    });
  }

  function isPathClear(path: ConstrainedPath): boolean {
    validateConstrainedPath(path);
    validatePathObstacleIds(path, obstacleIds);

    return path.sections.every(section => {
      const exemptions = new Set(section.exemptObstacleIds);
      const overrides = new Map(
        section.obstacleOverrides?.map(({
          collisionTolerance = 0,
          id,
          obstacleClearance = 0
        }) => [ id, collisionTolerance - obstacleClearance ])
      );

      return toSegments(section.points).every(([ start, end ]) => {
        return segmentIsClear(
          start,
          end,
          (section.collisionTolerance ?? 0) - section.obstacleClearance,
          exemptions,
          overrides
        );
      });
    });
  }

  function getCollisionObstacles(
      collisionInset: number
  ): Map<RouterObstacleId, RouterObstacleSnapshot> {
    const cached = collisionObstaclesByInset.get(collisionInset);

    if (cached) {
      return cached;
    }

    const collisionObstacles = new Map(obstacleSnapshots
      .filter(({ excluded }) => !excluded)
      .map(({ excluded, id, rect }) => [
        id,
        {
          excluded,
          id,
          rect: inset(rect, collisionInset)
        }
      ]));

    collisionObstaclesByInset.set(collisionInset, collisionObstacles);

    return collisionObstacles;
  }

  function findRoute(start: Point, end: Point): Point[] | null {
    return findRoutes([ { start, end } ])[0];
  }

  function findRoutes(requests: RouteRequest[]): (Point[] | null)[] {
    if (!Array.isArray(requests) || !requests.length) {
      throw new TypeError('route requests must be a non-empty array');
    }

    requests.forEach(({ start, end }, index) => {
      validatePoint(start, `route requests[${ index }].start`);
      validatePoint(end, `route requests[${ index }].end`);
    });

    const extents = getShapeExtents(obstacleSnapshots);
    const baseXs = new Set([
      extents.minX - ROUTING_MARGIN,
      extents.maxX + ROUTING_MARGIN
    ]);
    const baseYs = new Set([
      extents.minY - ROUTING_MARGIN,
      extents.maxY + ROUTING_MARGIN
    ]);

    for (const { rect } of obstacleSnapshots) {
      baseXs.add(rect.x - ROUTING_MARGIN);
      baseXs.add(rect.x + rect.width + ROUTING_MARGIN);
      baseYs.add(rect.y - ROUTING_MARGIN);
      baseYs.add(rect.y + rect.height + ROUTING_MARGIN);
    }

    const xs = new Set([
      ...requests.flatMap(({ start, end }) => [ start.x, end.x ]),
      ...baseXs
    ]);
    const ys = new Set([
      ...requests.flatMap(({ start, end }) => [ start.y, end.y ]),
      ...baseYs
    ]);
    const requestIntersections = new Set(requests.flatMap(({ start, end }) => [
      `${ start.x },${ start.y }`,
      `${ start.x },${ end.y }`,
      `${ end.x },${ start.y }`,
      `${ end.x },${ end.y }`
    ]));
    const points: Point[] = [];

    for (const x of xs) {
      for (const y of ys) {
        if (
          !baseXs.has(x) &&
          !baseYs.has(y) &&
          !requestIntersections.has(`${ x },${ y }`)
        ) {
          continue;
        }

        const candidate = point(x, y);

        if (!isInsideAny(candidate, obstacleSnapshots)) {
          points.push(candidate);
        }
      }
    }

    const endpointIndexesByPoint = new Map(points.map((candidate, index) => [
      `${ candidate.x },${ candidate.y }`,
      index
    ]));
    const appendEndpoint = (candidate: Point): number => {
      const key = `${ candidate.x },${ candidate.y }`;
      const existing = endpointIndexesByPoint.get(key);

      if (existing !== undefined) {
        return existing;
      }

      const index = points.push(candidate) - 1;

      endpointIndexesByPoint.set(key, index);
      return index;
    };
    const endpointIndexes = requests.map(({ start, end }) => ({
      startIndex: appendEndpoint(start),
      endIndex: appendEndpoint(end)
    }));

    if (points.length > maxVisibilityPoints) {
      return requests.map(() => null);
    }

    const { pointsByX, pointsByY } = indexVisibilityPoints(points);
    const visibilityGraph = buildVisibilityGraph(
      points,
      pointsByX,
      pointsByY
    );
    const requestsByStart = new Map<number, {
      endIndex: number;
      requestIndex: number;
    }[]>();

    endpointIndexes.forEach(({ startIndex, endIndex }, requestIndex) => {
      const grouped = requestsByStart.get(startIndex) || [];

      grouped.push({ endIndex, requestIndex });
      requestsByStart.set(startIndex, grouped);
    });

    const results: (Point[] | null)[] = requests.map(() => null);

    for (const [ startIndex, grouped ] of requestsByStart) {
      const routes = searchVisibilityRoutes(
        points,
        visibilityGraph,
        startIndex,
        grouped.map(({ endIndex }) => endIndex)
      );

      grouped.forEach(({ endIndex, requestIndex }) => {
        results[requestIndex] = routes.get(endIndex) || null;
      });
    }

    return results;
  }

  function searchVisibilityRoutes(
      points: Point[],
      visibilityGraph: VisibilityEdge[][],
      startIndex: number,
      endIndexes: number[]
  ): Map<number, Point[]> {
    const startState = points.length * 2;
    const distance = Array<number>(startState + 1).fill(Infinity);
    const previous = Array<number>(startState + 1).fill(-1);
    const pending = new Set<number>(distance.map((_, index) => index));
    const pendingEnds = new Set(endIndexes);
    const endStates = new Map<number, number>();
    const queue: VisibilityNode[] = [];
    distance[startState] = 0;
    pushVisibilityNode(queue, { index: startState, distance: 0 });

    while (queue.length) {
      const entry = popVisibilityNode(queue);
      const currentState = entry.index;

      if (
        !pending.has(currentState) ||
        entry.distance !== distance[currentState]
      ) {
        continue;
      }

      pending.delete(currentState);

      const current = currentState === startState
        ? startIndex
        : Math.floor(currentState / 2);

      if (pendingEnds.delete(current)) {
        endStates.set(current, currentState);

        if (!pendingEnds.size) {
          break;
        }
      }

      for (const edge of visibilityGraph[current]) {
        const nextState = edge.index * 2 + edge.direction;

        if (!pending.has(nextState)) {
          continue;
        }

        const candidate = distance[currentState] +
          manhattan(points[current], points[edge.index]) +
          (
            currentState === startState ||
            currentState % 2 !== edge.direction
              ? VISIBILITY_GRAPH_TURN_PENALTY
              : 0
          );

        if (candidate < distance[nextState]) {
          distance[nextState] = candidate;
          previous[nextState] = currentState;
          pushVisibilityNode(queue, {
            index: nextState,
            distance: candidate
          });
        }
      }
    }

    const routes = new Map<number, Point[]>();

    for (const endIndex of endIndexes) {
      const endState = endStates.get(endIndex);

      if (endState === undefined) {
        continue;
      }

      const route: Point[] = [];

      for (
        let currentState = endState;
        currentState !== -1;
        currentState = previous[currentState]
      ) {
        const current = currentState === startState
          ? startIndex
          : Math.floor(currentState / 2);

        route.unshift(points[current]);
      }

      routes.set(endIndex, cleanPoints(route));
    }

    return routes;
  }

  function buildVisibilityGraph(
      points: Point[],
      pointsByX: Map<number, number[]>,
      pointsByY: Map<number, number[]>
  ): VisibilityEdge[][] {
    const graph = points.map(() => [] as VisibilityEdge[]);

    for (const [ indexes, coordinate, direction ] of [
      [ ...pointsByX.values() ].map(indexes => [
        indexes,
        (index: number) => points[index].y,
        1
      ] as const),
      [ ...pointsByY.values() ].map(indexes => [
        indexes,
        (index: number) => points[index].x,
        0
      ] as const)
    ].flat()) {
      const ordered = [ ...indexes ].sort((a, b) => {
        return coordinate(a) - coordinate(b) || a - b;
      });

      for (let index = 1; index < ordered.length; index++) {
        const a = ordered[index - 1];
        const b = ordered[index];

        if (!segmentIsClear(points[a], points[b])) {
          continue;
        }

        graph[a].push({ direction, index: b });
        graph[b].push({ direction, index: a });
      }
    }

    graph.forEach(edges => edges.sort((a, b) => {
      return a.index - b.index || a.direction - b.direction;
    }));

    return graph;
  }

  return Object.freeze({
    findRoute,
    findRoutes,
    isClear,
    isPathClear,
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

  const { excluded = false, id = index, rect } = obstacle;

  if (typeof excluded !== 'boolean') {
    throw new TypeError(`obstacles[${ index }].excluded must be a boolean`);
  }

  validateRect(rect, `obstacles[${ index }].rect`);

  return {
    excluded,
    id,
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
    collisionTolerance: number,
    obstacleClearance: number,
    allowPerpendicularCrossings: boolean,
    maxVisibilityPoints: number
): void {
  if (!Array.isArray(obstacles)) {
    throw new TypeError('obstacles must be an array');
  }

  if (!Array.isArray(routes)) {
    throw new TypeError('routes must be an array');
  }

  if (!Number.isFinite(collisionTolerance) || collisionTolerance < 0) {
    throw new TypeError(
      'collisionTolerance must be a non-negative finite number'
    );
  }

  if (!Number.isFinite(obstacleClearance) || obstacleClearance < 0) {
    throw new TypeError(
      'obstacleClearance must be a non-negative finite number'
    );
  }

  if (typeof allowPerpendicularCrossings !== 'boolean') {
    throw new TypeError('allowPerpendicularCrossings must be a boolean');
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

function validateConstrainedPath(path: ConstrainedPath): void {
  if (!path || typeof path !== 'object') {
    throw new TypeError('path must be an object');
  }

  if (!Array.isArray(path.sections) || !path.sections.length) {
    throw new TypeError('path.sections must be a non-empty array');
  }

  let previousEnd: Point | undefined;

  path.sections.forEach((section, sectionIndex) => {
    const name = `path.sections[${ sectionIndex }]`;

    if (!section || typeof section !== 'object') {
      throw new TypeError(`${ name } must be an object`);
    }

    if (
      !Number.isFinite(section.obstacleClearance) ||
      section.obstacleClearance < 0
    ) {
      throw new TypeError(
        `${ name }.obstacleClearance must be a non-negative finite number`
      );
    }

    if (
      section.collisionTolerance !== undefined &&
      (
        !Number.isFinite(section.collisionTolerance) ||
        section.collisionTolerance < 0
      )
    ) {
      throw new TypeError(
        `${ name }.collisionTolerance must be a non-negative finite number`
      );
    }

    if (
      section.exemptObstacleIds !== undefined &&
      !Array.isArray(section.exemptObstacleIds)
    ) {
      throw new TypeError(`${ name }.exemptObstacleIds must be an array`);
    }

    if (
      section.obstacleOverrides !== undefined &&
      !Array.isArray(section.obstacleOverrides)
    ) {
      throw new TypeError(`${ name }.obstacleOverrides must be an array`);
    }

    section.obstacleOverrides?.forEach((override, overrideIndex) => {
      const overrideName = `${ name }.obstacleOverrides[${ overrideIndex }]`;

      if (!override || typeof override !== 'object') {
        throw new TypeError(`${ overrideName } must be an object`);
      }

      for (const [ property, value ] of [
        [ 'collisionTolerance', override.collisionTolerance ?? 0 ],
        [ 'obstacleClearance', override.obstacleClearance ?? 0 ]
      ] as const) {
        if (!Number.isFinite(value) || value < 0) {
          throw new TypeError(
            `${ overrideName }.${ property } must be a non-negative finite number`
          );
        }
      }
    });

    validatePoints(section.points, `${ name }.points`);

    if (section.points.length < 2) {
      throw new TypeError(`${ name }.points must contain at least two points`);
    }

    const start = section.points[0];

    if (
      previousEnd &&
      (start.x !== previousEnd.x || start.y !== previousEnd.y)
    ) {
      throw new TypeError('path sections must be connected');
    }

    previousEnd = section.points[section.points.length - 1];
  });
}

function validatePathObstacleIds(
    path: ConstrainedPath,
    obstacleIds: ReadonlySet<RouterObstacleId>
): void {
  path.sections.forEach((section, sectionIndex) => {
    const referencedIds = [
      ...(section.exemptObstacleIds || []),
      ...(section.obstacleOverrides || []).map(({ id }) => id)
    ];
    const uniqueIds = new Set(referencedIds);

    if (uniqueIds.size !== referencedIds.length) {
      throw new TypeError(
        `path.sections[${ sectionIndex }] obstacle ids must be unique`
      );
    }

    for (const id of referencedIds) {
      if (!obstacleIds.has(id)) {
        throw new TypeError(
          `path.sections[${ sectionIndex }] references an unknown obstacle id`
        );
      }
    }
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
