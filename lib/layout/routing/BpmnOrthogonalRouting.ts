import { createOrthogonalRouter } from './OrthogonalRouting.js';
import { ROUTE_COLLISION_TOLERANCE } from '../Constants.js';

import type { Point, Rect } from 'diagram-js/lib/util/Types.js';
import type { BpmnElement } from '../Types.js';
import type {
  ConstrainedPath,
  OrthogonalRouter
} from './OrthogonalRouting.js';
import type { DockPair } from './BpmnDockRouting.js';

type BpmnRouterShape = { element: BpmnElement; rect: Rect };
type RoutedConnection = {
  flow: BpmnElement & { sourceRef?: BpmnElement; targetRef?: BpmnElement };
  points: Point[];
};
type BpmnOrthogonalRouterOptions = {
  shapes?: BpmnRouterShape[];
  sourceElement?: BpmnElement;
  targetElement?: BpmnElement;
  routedConnections?: RoutedConnection[];
  collisionTolerance?: number;
  obstacleClearance?: number;
  allowPerpendicularCrossings?: boolean;
  maxVisibilityPoints?: number;
};

export type BpmnPathRole =
  | 'source-dock'
  | 'connector'
  | 'channel'
  | 'target-dock'
  | 'direct';

export type BpmnPathSection = {
  points: Point[];
  role: BpmnPathRole;
};

export type BpmnPath = {
  sections: BpmnPathSection[];
};

export type BpmnPathPolicy = {
  channelClearance?: number;
  connectorClearance?: number;
  connectorCollisionTolerance?: number;
  dockingClearance?: number;
  dockingCollisionTolerance?: number;
};

export type BpmnOrthogonalRouter = OrthogonalRouter & {
  findBpmnRoutes(pairs: DockPair[]): (Point[] | null)[];
  isBpmnPathClear(path: BpmnPath, policy?: BpmnPathPolicy): boolean;
};

export function createBpmnOrthogonalRouter({
  shapes = [],
  sourceElement,
  targetElement,
  routedConnections = [],
  collisionTolerance,
  obstacleClearance,
  allowPerpendicularCrossings,
  maxVisibilityPoints
}: BpmnOrthogonalRouterOptions = {}): BpmnOrthogonalRouter {
  const obstacles = shapes.map(({ element, rect }) => ({
    id: element,
    rect
  }));
  const obstacleIds = new Set(obstacles.map(({ id }) => id));
  const routes = routedConnections.map(({ flow, points }) => ({
    allowCollinearOverlap: sharesEndpointChannel(
      flow,
      sourceElement,
      targetElement
    ),
    points
  }));
  const commonOptions = {
    routes,
    collisionTolerance,
    obstacleClearance,
    allowPerpendicularCrossings,
    maxVisibilityPoints
  };
  const router = createOrthogonalRouter({
    ...commonOptions,
    obstacles: obstacles.map(obstacle => ({
      ...obstacle,
      excluded: obstacle.id === sourceElement || obstacle.id === targetElement
    }))
  });
  let constrainedRouter: OrthogonalRouter | undefined;

  function getConstrainedRouter(): OrthogonalRouter {
    constrainedRouter ||= createOrthogonalRouter({
      ...commonOptions,
      obstacles
    });

    return constrainedRouter;
  }

  function findBpmnRoutes(pairs: DockPair[]): (Point[] | null)[] {
    if (!Array.isArray(pairs) || !pairs.length) {
      throw new TypeError('dock pairs must be a non-empty array');
    }

    const router = getConstrainedRouter();
    const visibilityRoutes = router.findRoutes(pairs.map(pair => ({
      start: pair.source.stub,
      end: pair.target.stub
    })));

    return visibilityRoutes.map((visibilityRoute, index) => {
      if (!visibilityRoute) {
        return null;
      }

      const pair = pairs[index];
      const path: BpmnPath = {
        sections: [
          {
            role: 'source-dock',
            points: [ pair.source.dock, pair.source.stub ]
          },
          ...(visibilityRoute.length > 1
            ? [ {
              role: 'connector' as const,
              points: visibilityRoute
            } ]
            : []),
          {
            role: 'target-dock',
            points: [ pair.target.stub, pair.target.dock ]
          }
        ]
      };

      return isBpmnPathClear(path)
        ? flattenBpmnPath(path)
        : null;
    });
  }

  function isBpmnPathClear(
      path: BpmnPath,
      policy: BpmnPathPolicy = {}
  ): boolean {
    validateBpmnPathPolicy(policy);

    return getConstrainedRouter().isPathClear(toConstrainedPath(
      path,
      policy,
      sourceElement,
      targetElement,
      obstacleIds
    ));
  }

  return Object.freeze({
    ...router,
    findBpmnRoutes,
    isBpmnPathClear
  });
}

export function flattenBpmnPath(path: BpmnPath): Point[] {
  validateBpmnPath(path);

  return path.sections.flatMap(({ points }, index) => {
    return index ? points.slice(1) : points;
  });
}

export function bpmnPathFromPoints(points: Point[]): BpmnPath {
  if (!Array.isArray(points) || points.length < 2) {
    throw new TypeError('points must contain at least two points');
  }

  if (points.length === 2) {
    return {
      sections: [ {
        role: 'direct',
        points: [ points[0], points[1] ]
      } ]
    };
  }

  return {
    sections: points.slice(1).map((end, index) => ({
      role: index === 0
        ? 'source-dock'
        : index === points.length - 2
          ? 'target-dock'
          : 'connector',
      points: [ points[index], end ]
    }))
  };
}

function toConstrainedPath(
    path: BpmnPath,
    {
      channelClearance = 0,
      connectorClearance = 0,
      connectorCollisionTolerance = ROUTE_COLLISION_TOLERANCE,
      dockingClearance = 0,
      dockingCollisionTolerance = ROUTE_COLLISION_TOLERANCE
    }: BpmnPathPolicy,
    sourceElement: BpmnElement | undefined,
    targetElement: BpmnElement | undefined,
    obstacleIds: ReadonlySet<BpmnElement>
): ConstrainedPath {
  validateBpmnPath(path);

  return {
    sections: path.sections.map(({ points, role }, index) => {
      const channel = role === 'channel';
      const direct = role === 'direct';
      const adjacentEndpointOverrides = [
        ...(
          channel &&
          index > 0 &&
          path.sections[index - 1].role === 'source-dock' &&
          sourceElement &&
          obstacleIds.has(sourceElement)
            ? [ {
              collisionTolerance: ROUTE_COLLISION_TOLERANCE,
              id: sourceElement
            } ]
            : []
        ),
        ...(
          channel &&
          index < path.sections.length - 1 &&
          path.sections[index + 1].role === 'target-dock' &&
          targetElement &&
          obstacleIds.has(targetElement)
            ? [ {
              collisionTolerance: ROUTE_COLLISION_TOLERANCE,
              id: targetElement
            } ]
            : []
        )
      ].filter((override, overrideIndex, overrides) => {
        return overrides.findIndex(candidate => {
          return candidate.id === override.id;
        }) === overrideIndex;
      });

      return {
        collisionTolerance: channel
          ? 0
          : role === 'connector'
            ? connectorCollisionTolerance
            : dockingCollisionTolerance,
        obstacleClearance: channel
          ? channelClearance
          : role === 'connector'
            ? connectorClearance
            : dockingClearance,
        exemptObstacleIds: role === 'source-dock' &&
          sourceElement &&
          obstacleIds.has(sourceElement)
          ? [ sourceElement ]
          : role === 'target-dock' &&
            targetElement &&
            obstacleIds.has(targetElement)
            ? [ targetElement ]
            : direct
              ? [
                ...(sourceElement && obstacleIds.has(sourceElement)
                  ? [ sourceElement ]
                  : []),
                ...(
                  targetElement &&
                  targetElement !== sourceElement &&
                  obstacleIds.has(targetElement)
                    ? [ targetElement ]
                    : []
                )
              ]
              : [],
        obstacleOverrides: adjacentEndpointOverrides,
        points
      };
    })
  };
}

function validateBpmnPath(path: BpmnPath): void {
  if (
    !path ||
    typeof path !== 'object' ||
    !Array.isArray(path.sections) ||
    !path.sections.length
  ) {
    throw new TypeError('path.sections must be a non-empty array');
  }

  path.sections.forEach((section, index) => {
    if (!section || typeof section !== 'object') {
      throw new TypeError(`path.sections[${ index }] must be an object`);
    }

    const { points, role } = section;

    if (![
      'source-dock',
      'connector',
      'channel',
      'target-dock',
      'direct'
    ].includes(role)) {
      throw new TypeError(`path.sections[${ index }].role is invalid`);
    }

    if (role === 'source-dock' && index !== 0) {
      throw new TypeError('source-dock must be the first path section');
    }

    if (role === 'target-dock' && index !== path.sections.length - 1) {
      throw new TypeError('target-dock must be the last path section');
    }

    if (role === 'direct' && path.sections.length !== 1) {
      throw new TypeError('direct must be the only path section');
    }

    if (!Array.isArray(points) || points.length < 2) {
      throw new TypeError(
        `path.sections[${ index }].points must contain at least two points`
      );
    }

    if (index) {
      const previous = path.sections[index - 1].points;
      const previousEnd = previous[previous.length - 1];
      const start = points?.[0];

      if (
        !previousEnd ||
        !start ||
        previousEnd.x !== start.x ||
        previousEnd.y !== start.y
      ) {
        throw new TypeError('path sections must be connected');
      }
    }
  });
}

function validateBpmnPathPolicy(policy: BpmnPathPolicy): void {
  if (!policy || typeof policy !== 'object') {
    throw new TypeError('path policy must be an object');
  }

  for (const [ name, value ] of [
    [ 'channelClearance', policy.channelClearance ?? 0 ],
    [ 'connectorClearance', policy.connectorClearance ?? 0 ],
    [
      'connectorCollisionTolerance',
      policy.connectorCollisionTolerance ?? ROUTE_COLLISION_TOLERANCE
    ],
    [ 'dockingClearance', policy.dockingClearance ?? 0 ],
    [
      'dockingCollisionTolerance',
      policy.dockingCollisionTolerance ?? ROUTE_COLLISION_TOLERANCE
    ]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${ name } must be a non-negative finite number`);
    }
  }
}

function sharesEndpointChannel(
    flow: RoutedConnection['flow'],
    source: BpmnElement | undefined,
    target: BpmnElement | undefined
): boolean {
  return flow.sourceRef === source ||
    flow.targetRef === target ||
    (flow.$instanceOf('bpmn:MessageFlow') && (
      (flow.sourceRef === target && flow.targetRef !== source) ||
      (flow.targetRef === source && flow.sourceRef !== target)
    ));
}
