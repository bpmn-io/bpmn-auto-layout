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
  point,
  pointInRect,
  segmentEntersRect,
  segmentsProperlyCross,
  toSegments
} from '../geometry/index.js';

export function createOrthogonalRouter({
  obstacles = [],
  routes = [],
  obstacleInset = ROUTE_OBSTACLE_INSET,
  allowPerpendicularCrossings = false,
  maxVisibilityPoints = Infinity
} = {}) {
  validateRouterOptions(
    obstacles,
    routes,
    obstacleInset,
    allowPerpendicularCrossings,
    maxVisibilityPoints
  );

  const obstacleSnapshots = obstacles.map(snapshotObstacle);
  const routeSnapshots = routes.map(snapshotRoute);
  const collisionObstacles = obstacleSnapshots
    .filter(({ excluded }) => !excluded)
    .map(({ rect }) => inset(rect, obstacleInset));
  const allocatedSegments = routeSnapshots.flatMap(route => {
    return toSegments(route.points).map(([ start, end ]) => ({
      allowCollinearOverlap: route.allowCollinearOverlap,
      end,
      start
    }));
  });

  function isSegmentClear(a, b) {
    validatePoint(a, 'segment start');
    validatePoint(b, 'segment end');

    return segmentIsClear(a, b);
  }

  function segmentIsClear(a, b) {
    if (a.x === b.x && a.y === b.y) {
      return false;
    }

    if (collisionObstacles.some(rect => segmentEntersRect(a, b, rect))) {
      return false;
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

  function isClear(points) {
    validatePoints(points, 'path');

    return toSegments(points).every(([ start, end ]) => {
      return segmentIsClear(start, end);
    });
  }

  function findRoute(start, end) {
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

    const points = [];

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
    const distance = Array(points.length).fill(Infinity);
    const previous = Array(points.length).fill(-1);
    const pending = new Set(points.map((_, index) => index));
    const queue = [];
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

    const route = [];

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

function snapshotObstacle(obstacle, index) {
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

function snapshotRoute(route, index) {
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
    obstacles,
    routes,
    obstacleInset,
    allowPerpendicularCrossings,
    maxVisibilityPoints) {
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

  if (
    maxVisibilityPoints !== Infinity &&
    (!Number.isFinite(maxVisibilityPoints) || maxVisibilityPoints < 0)
  ) {
    throw new TypeError(
      'maxVisibilityPoints must be a non-negative finite number or Infinity'
    );
  }
}

function validateRect(rect, name) {
  if (!rect || typeof rect !== 'object') {
    throw new TypeError(`${ name } must be an object`);
  }

  for (const key of [ 'x', 'y', 'width', 'height' ]) {
    if (!Number.isFinite(rect[key])) {
      throw new TypeError(`${ name }.${ key } must be finite`);
    }
  }
}

function validatePoints(points, name) {
  if (!Array.isArray(points)) {
    throw new TypeError(`${ name } must be an array`);
  }

  points.forEach((candidate, index) => {
    validatePoint(candidate, `${ name }[${ index }]`);
  });
}

function validatePoint(candidate, name) {
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError(`${ name } must be an object`);
  }

  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
    throw new TypeError(`${ name } coordinates must be finite`);
  }
}

function indexVisibilityPoints(points) {
  const pointsByX = new Map();
  const pointsByY = new Map();

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

function appendVisibilityPoint(index, coordinate, pointIndex) {
  const points = index.get(coordinate);

  if (points) {
    points.push(pointIndex);
  } else {
    index.set(coordinate, [ pointIndex ]);
  }
}

function pushVisibilityNode(queue, entry) {
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

function popVisibilityNode(queue) {
  const first = queue[0];
  const last = queue.pop();

  if (queue.length) {
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

function compareVisibilityNodes(a, b) {
  return a.distance - b.distance || a.index - b.index;
}

function isInsideAny(candidate, obstacles) {
  return obstacles.some(({ excluded, rect }) => {
    return !excluded && pointInRect(candidate, rect);
  });
}
