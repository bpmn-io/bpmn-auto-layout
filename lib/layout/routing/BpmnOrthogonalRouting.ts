import { createOrthogonalRouter } from './OrthogonalRouting.js';
import { ROUTE_COLLISION_TOLERANCE } from '../Constants.js';

import type { Point, Rect } from 'diagram-js/lib/util/Types.js';
import type { BpmnElement } from '../Types.js';
import type {
  ConstrainedPath,
  OrthogonalRouter
} from './OrthogonalRouting.js';

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
  | 'target-dock';

export type BpmnPathSection = {
  points: Point[];
  role: BpmnPathRole;
};

export type BpmnPath = {
  sections: BpmnPathSection[];
};

export type BpmnPathPolicy = {
  channelClearance: number;
  connectorClearance?: number;
  connectorCollisionTolerance?: number;
  dockingClearance?: number;
  dockingCollisionTolerance?: number;
};

export type BpmnOrthogonalRouter = OrthogonalRouter & {
  isBpmnPathClear(path: BpmnPath, policy: BpmnPathPolicy): boolean;
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

  function isBpmnPathClear(
      path: BpmnPath,
      policy: BpmnPathPolicy
  ): boolean {
    validateBpmnPathPolicy(policy);

    constrainedRouter ||= createOrthogonalRouter({
      ...commonOptions,
      obstacles
    });

    return constrainedRouter.isPathClear(toConstrainedPath(
      path,
      policy,
      sourceElement,
      targetElement,
      obstacleIds
    ));
  }

  return Object.freeze({
    ...router,
    isBpmnPathClear
  });
}

export function flattenBpmnPath(path: BpmnPath): Point[] {
  validateBpmnPath(path);

  return path.sections.flatMap(({ points }, index) => {
    return index ? points.slice(1) : points;
  });
}

function toConstrainedPath(
    path: BpmnPath,
    {
      channelClearance,
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
      'target-dock'
    ].includes(role)) {
      throw new TypeError(`path.sections[${ index }].role is invalid`);
    }

    if (role === 'source-dock' && index !== 0) {
      throw new TypeError('source-dock must be the first path section');
    }

    if (role === 'target-dock' && index !== path.sections.length - 1) {
      throw new TypeError('target-dock must be the last path section');
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
    [ 'channelClearance', policy.channelClearance ],
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
