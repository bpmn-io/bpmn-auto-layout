import type { Point, Rect } from 'diagram-js/lib/util/Types.js';

import type { BpmnElement } from '../../Types.js';
import type { BpmnPath } from '../../routing/BpmnOrthogonalRouting.js';
import type { BpmnFlowNode, BpmnSequenceFlow } from '../../../moddle-types/bpmn.js';
import type { ModdleElement } from 'moddle';

type FlowNode = ModdleElement<BpmnFlowNode> & { default?: FlowEdge; eventDefinitions?: BpmnElement[] };
type FlowEdge = ModdleElement<BpmnSequenceFlow> & { sourceRef: FlowNode; targetRef: FlowNode };
type RouterShape = { element: BpmnElement; rect: Rect };
type RoutedConnection = { flow: FlowEdge; points: Point[] };
type Router = ReturnType<typeof createBpmnOrthogonalRouter>;
type RoutingPolicy = {
  backEdges: Set<FlowEdge>;
  bands: Map<BpmnElement, number>;
  straightEdges: Set<FlowEdge>;
  spine: Set<FlowEdge>;
  graphEdges: FlowEdge[];
  compactFeedbackNodes?: Set<BpmnElement>;
  feedbackBranchDepths?: Map<BpmnElement, number>;
  innerFeedbackEdges?: Set<BpmnElement>;
  nestedFeedbackLevels?: Map<BpmnElement, number>;
  adaptiveFeedbackSide?: boolean;
};
type FeedbackRouteCandidate = {
  points: Point[];
  score: number[];
};
type Classification = {
  feedback: boolean; isBack: boolean; sourceCenterX: number; targetCenterX: number;
  sourceCenterY: number; targetCenterY: number; horizontalTargetDock: boolean;
  targetDockY: number; longForward: boolean; sourceBoundary: boolean; sourceTop: boolean;
  boundaryRejoin: boolean; gatewayBranch: boolean; boundaryBranch: boolean;
  implicitBranch: boolean; crossBand: boolean; verticalTarget: boolean;
  alignedCrossBand: boolean; gatewayCrossBand: boolean; gatewayTargetAbove: boolean;
  targetFromAbove: boolean;
};
type Routing = Classification & { flow: FlowEdge; source: Rect; target: Rect; shapes: RouterShape[];
  routedConnections: RoutedConnection[]; policy: RoutingPolicy; router: Router; clearRouter: Router;
  start: Point; end: Point };
type ShapeByElement = Map<BpmnElement, Rect>;
type MaybeRoute = Point[] | null;

import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';
import {
  ROUTING_MARGIN,
  MAX_ROUTE_SEARCH_ATTEMPTS,
  MAX_LOCAL_U_CHANNEL_ATTEMPTS,
  ROUTE_COLLISION_TOLERANCE,
  LOCAL_U_OBSTACLE_CLEARANCE,
  MAX_VISIBILITY_GRAPH_POINTS
} from '../../Constants.js';
import {
  point,
  cleanPoints,
  inset,
  segmentEntersRect,
  getShapeExtents,
  routeLength
} from '../../geometry/index.js';
import {
  createBpmnOrthogonalRouter,
  flattenBpmnPath
} from '../../routing/BpmnOrthogonalRouting.js';

// Preferred fractional x-offsets (in that order) when searching for a clear
// vertical rejoin dock along a target's width.
function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected sequence flow routing value');
  }

  return value;
}

const CLEAR_DOCK_X_FRACTIONS = [ 0.5, 0.25, 0.75 ];

export function routeConnection(flow: FlowEdge, source: Rect, target: Rect, shapes: RouterShape[], routedConnections: RoutedConnection[], policy: RoutingPolicy): Point[] {
  const router = createSequenceFlowRouter(
    shapes,
    flow.sourceRef,
    flow.targetRef,
    routedConnections,
    { maxVisibilityPoints: MAX_VISIBILITY_GRAPH_POINTS }
  );
  const clearRouter = createSequenceFlowRouter(
    shapes,
    flow.sourceRef,
    flow.targetRef,
    [],
    { maxVisibilityPoints: MAX_VISIBILITY_GRAPH_POINTS }
  );

  if (isSelfLoop(flow)) {
    return routeSelfLoop(flow, source, target, clearRouter);
  }

  const classification = classifyConnection(
    flow,
    source,
    target,
    clearRouter,
    policy
  );
  const docks = selectConnectionDocks(
    flow,
    source,
    target,
    clearRouter,
    classification
  );
  const routing = {
    flow,
    source,
    target,
    shapes,
    routedConnections,
    policy,
    router,
    clearRouter,
    ...classification,
    ...docks
  };
  const preferredRoute = tryPreferredConnectionRoutes(routing);

  if (preferredRoute) {
    return preferredRoute;
  }

  return routeConnectionWithFallbacks(routing);
}

function isSelfLoop(flow: FlowEdge): boolean {
  return flow.sourceRef === flow.targetRef ||
    (
      is(flow.sourceRef, 'bpmn:BoundaryEvent') &&
      flow.sourceRef.attachedToRef === flow.targetRef
    );
}

function classifyConnection(flow: FlowEdge, source: Rect, target: Rect, clearRouter: Router, policy: RoutingPolicy): Classification {
  const feedback = policy.backEdges?.has(flow);
  const isBack = feedback || target.x < source.x;
  const sourceCenterX = source.x + source.width / 2;
  const targetCenterX = target.x + target.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterY = target.y + target.height / 2;
  const sameSemanticBand =
    (policy.bands.get(flow.sourceRef) || 0) ===
    (policy.bands.get(flow.targetRef) || 0);
  const horizontalTargetDock = !isBack &&
    sameSemanticBand &&
    sourceCenterY >= target.y &&
    sourceCenterY <= target.y + target.height;
  const targetDockY = horizontalTargetDock ? sourceCenterY : targetCenterY;
  const forwardStart = point(source.x + source.width, sourceCenterY);
  const forwardEnd = point(target.x, targetDockY);
  const longForward = !isBack &&
    sourceCenterY === targetCenterY &&
    !clearRouter.isClear([ forwardStart, forwardEnd ]);
  const sourceBoundary = is(flow.sourceRef, 'bpmn:BoundaryEvent');
  const sourceDefinition = flow.sourceRef.eventDefinitions || [];
  const sourceTop = sourceBoundary && sourceDefinition.some(definition => is(definition, 'bpmn:EscalationEventDefinition'));
  const boundaryRejoin = sourceBoundary && [ ...(policy.spine || []) ]
    .some(edge => edge.targetRef === flow.targetRef);
  const splitBranch = !isBack && !policy.straightEdges?.has(flow) &&
    (flow.sourceRef.outgoing || []).length > 1 &&
    sourceCenterY !== targetCenterY;
  const gatewayBranch = splitBranch && is(flow.sourceRef, 'bpmn:Gateway');
  const boundaryBranch = splitBranch && sourceBoundary;
  const implicitBranch = splitBranch && !gatewayBranch && !boundaryBranch;
  const crossBand = !isBack && !sourceBoundary &&
    !horizontalTargetDock &&
    sourceCenterY !== targetCenterY;
  const verticalTarget = crossBand && !splitBranch;
  const alignedCrossBand = crossBand && sourceCenterX === targetCenterX;
  const gatewayCrossBand = !isBack &&
    is(flow.sourceRef, 'bpmn:Gateway') &&
    (flow.sourceRef.outgoing || []).length > 1 &&
    sourceCenterY !== targetCenterY;
  const gatewayTargetAbove = gatewayCrossBand && targetCenterY < sourceCenterY;
  const targetFromAbove = crossBand && sourceCenterY < targetCenterY;

  return {
    feedback,
    isBack,
    sourceCenterX,
    targetCenterX,
    sourceCenterY,
    targetCenterY,
    horizontalTargetDock,
    targetDockY,
    longForward,
    sourceBoundary,
    sourceTop,
    boundaryRejoin,
    gatewayBranch,
    boundaryBranch,
    implicitBranch,
    crossBand,
    verticalTarget,
    alignedCrossBand,
    gatewayCrossBand,
    gatewayTargetAbove,
    targetFromAbove
  };
}

function selectConnectionDocks(
    flow: FlowEdge,
    source: Rect,
    target: Rect,
    clearRouter: Router,
    classification: Classification
): { start: Point; end: Point } {
  const {
    alignedCrossBand,
    boundaryRejoin,
    feedback,
    gatewayCrossBand,
    gatewayTargetAbove,
    isBack,
    longForward,
    sourceBoundary,
    sourceCenterX,
    sourceCenterY,
    sourceTop,
    targetCenterY,
    targetDockY,
    targetFromAbove,
    verticalTarget
  } = classification;
  const start = sourceBoundary
    ? point(source.x + source.width / 2, sourceTop ? source.y : source.y + source.height)
    : alignedCrossBand
      ? point(sourceCenterX, targetCenterY < sourceCenterY ? source.y : source.y + source.height)
      : gatewayCrossBand
        ? point(
          source.x + source.width / 2,
          gatewayTargetAbove ? source.y : source.y + source.height
        )
        : feedback || longForward
          ? point(source.x + source.width / 2, source.y + source.height)
          : isBack
            ? point(source.x, source.y + source.height / 2)
            : point(source.x + source.width, source.y + source.height / 2);
  const defaultEnd = feedback || longForward
    ? point(target.x + target.width / 2, target.y + target.height)
    : boundaryRejoin
      ? point(target.x + target.width / 2, sourceTop ? target.y : target.y + target.height)
      : verticalTarget
        ? point(target.x + target.width / 2, targetFromAbove ? target.y : target.y + target.height)
        : isBack
          ? point(target.x + target.width, target.y + target.height / 2)
          : point(target.x, targetDockY);
  const end = boundaryRejoin
    ? findClearVerticalDock(
      target,
      sourceTop,
      clearRouter
    )
    : defaultEnd;

  return { start, end };
}

function tryPreferredConnectionRoutes(routing: Routing): MaybeRoute {
  return tryDirectRoute(routing) ||
    tryBranchRoute(routing) ||
    tryCrossBandRoute(routing) ||
    tryLocalBypassRoute(routing);
}

function tryDirectRoute({
  end,
  isBack,
  router,
  start
}: Routing): MaybeRoute {
  if (
    !isBack &&
    start.y === end.y &&
    router.isClear([ start, end ])
  ) {
    return [ start, end ];
  }

  return null;
}

function tryBranchRoute(routing: Routing): MaybeRoute {
  const {
    boundaryBranch,
    end,
    gatewayBranch,
    implicitBranch,
    router,
    start
  } = routing;

  if (gatewayBranch || boundaryBranch) {
    const branchRoute = cleanPoints([ start, point(start.x, end.y), end ]);

    if (router.isClear(branchRoute)) {
      return branchRoute;
    }
  }

  if (implicitBranch) {
    const channelX = Math.round((start.x + end.x) / 2);
    const branchRoute = cleanPoints([
      start,
      point(channelX, start.y),
      point(channelX, end.y),
      end
    ]);

    if (router.isClear(branchRoute)) {
      return branchRoute;
    }
  }

  return null;
}

function tryCrossBandRoute(routing: Routing): MaybeRoute {
  const {
    crossBand,
    end,
    flow,
    router,
    source,
    sourceCenterX,
    sourceCenterY,
    start,
    target,
    targetCenterX,
    targetCenterY
  } = routing;

  if (!crossBand) {
    return null;
  }

  const joinRoute = cleanPoints([ start, point(end.x, start.y), end ]);

  if (router.isClear(joinRoute)) {
    return joinRoute;
  }

  const targetAbove = targetCenterY < sourceCenterY;
  const centeredEndpoints =
    (is(flow.sourceRef, 'bpmn:Event') || is(flow.sourceRef, 'bpmn:Gateway')) &&
    (is(flow.targetRef, 'bpmn:Event') || is(flow.targetRef, 'bpmn:Gateway'));

  if (centeredEndpoints) {
    const facingStart = point(
      sourceCenterX,
      targetAbove ? source.y : source.y + source.height
    );
    const facingEnd = point(
      targetCenterX,
      targetAbove ? target.y + target.height : target.y
    );

    for (let attempt = 1; attempt <= MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
      const channelY = facingEnd.y +
        (targetAbove ? 1 : -1) * attempt * ROUTING_MARGIN;

      if (
        (targetAbove && channelY >= facingStart.y) ||
        (!targetAbove && channelY <= facingStart.y)
      ) {
        break;
      }

      const facingRoute = cleanPoints([
        facingStart,
        point(facingStart.x, channelY),
        point(facingEnd.x, channelY),
        facingEnd
      ]);

      if (router.isClear(facingRoute)) {
        return facingRoute;
      }
    }
  }

  const transposedStart = point(
    sourceCenterX,
    targetAbove ? source.y : source.y + source.height
  );
  const transposedEnd = point(
    sourceCenterX < targetCenterX ? target.x : target.x + target.width,
    targetCenterY
  );
  const transposedRoute = cleanPoints([
    transposedStart,
    point(transposedStart.x, transposedEnd.y),
    transposedEnd
  ]);

  if (router.isClear(transposedRoute)) {
    return transposedRoute;
  }

  return null;
}

function tryLocalBypassRoute({
  end,
  feedback,
  flow,
  longForward,
  policy,
  routedConnections,
  shapes,
  sourceBoundary,
  start
}: Routing): MaybeRoute {
  const candidateFeedback =
    feedback && policy.compactFeedbackNodes?.has(flow.sourceRef);

  if (candidateFeedback ||
      (!longForward && (!feedback || sourceBoundary))) {
    return null;
  }

  return findLocalUBypass(
    flow,
    start,
    end,
    shapes,
    policy,
    routedConnections
  );
}

function routeConnectionWithFallbacks(routing: Routing): Point[] {
  const extents = getShapeExtents(routing.shapes);

  return tryBoundaryRejoinChannels(routing) ||
    tryInnerFeedbackChannel(routing) ||
    tryNestedFeedbackChannel(routing, extents) ||
    tryFeedbackDockCandidates(routing, extents) ||
    tryFeedbackChannels(routing, extents) ||
    tryPreferredChannel(routing, extents) ||
    tryVisibilityRoutes(routing) ||
    tryOuterRoutes(routing) ||
    routePerimeterOrThrow(routing);
}

function tryInnerFeedbackChannel(
    {
      flow,
      policy,
      routedConnections,
      shapes,
      source,
      target
    }: Routing
): MaybeRoute {
  if (!policy.innerFeedbackEdges?.has(flow)) {
    return null;
  }

  const routedConnectionsWithoutSharedTarget = routedConnections.filter(connection => {
    return connection.flow.targetRef !== flow.targetRef;
  });
  const sharedTargetRouter = createSequenceFlowRouter(
    shapes,
    flow.sourceRef,
    flow.targetRef,
    routedConnectionsWithoutSharedTarget,
    { maxVisibilityPoints: MAX_VISIBILITY_GRAPH_POINTS }
  );
  const sourceNorth = point(
    source.x + source.width / 2,
    source.y
  );
  const sourceEast = point(
    source.x + source.width,
    source.y + source.height / 2
  );
  const targetNorth = point(
    target.x + target.width / 2,
    target.y
  );

  for (let attempt = 1; attempt <= MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
    const channelY = target.y - attempt * ROUTING_MARGIN;
    const northChannelStart = point(sourceNorth.x, channelY);
    const eastExit = point(
      sourceEast.x + ROUTING_MARGIN,
      sourceEast.y
    );
    const eastChannelStart = point(eastExit.x, channelY);
    const targetChannelEnd = point(targetNorth.x, channelY);
    const candidates: BpmnPath[] = [
      {
        sections: [
          {
            role: 'source-dock',
            points: [ sourceNorth, northChannelStart ]
          },
          {
            role: 'channel',
            points: [ northChannelStart, targetChannelEnd ]
          },
          {
            role: 'target-dock',
            points: [ targetChannelEnd, targetNorth ]
          }
        ]
      },
      {
        sections: [
          {
            role: 'source-dock',
            points: [ sourceEast, eastExit ]
          },
          {
            role: 'connector',
            points: [ eastExit, eastChannelStart ]
          },
          {
            role: 'channel',
            points: [ eastChannelStart, targetChannelEnd ]
          },
          {
            role: 'target-dock',
            points: [ targetChannelEnd, targetNorth ]
          }
        ]
      }
    ];

    for (const candidate of candidates) {
      if (sharedTargetRouter.isBpmnPathClear(candidate, {
        channelClearance: ROUTING_MARGIN
      })) {
        return cleanPoints(flattenBpmnPath(candidate));
      }
    }
  }

  return null;
}

function tryNestedFeedbackChannel(
    {
      flow,
      policy,
      router,
      source,
      target
    }: Routing,
    extents: { maxX: number; maxY: number }
): MaybeRoute {
  const level = policy.nestedFeedbackLevels?.get(flow);

  if (!level) {
    return null;
  }

  const sourceEast = point(
    source.x + source.width,
    source.y + source.height / 2
  );
  const targetSouth = point(
    target.x + target.width / 2,
    target.y + target.height
  );

  for (let attempt = 0; attempt < MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
    const spacing = (level + attempt) * ROUTING_MARGIN;
    const channelX = extents.maxX + spacing;
    const channelY = extents.maxY + spacing;
    const candidate = cleanPoints([
      sourceEast,
      point(channelX, sourceEast.y),
      point(channelX, channelY),
      point(targetSouth.x, channelY),
      targetSouth
    ]);

    if (router.isClear(candidate)) {
      return candidate;
    }
  }

  return null;
}

function tryBoundaryRejoinChannels({
  boundaryRejoin,
  end,
  router,
  sourceTop,
  start
}: Routing) {
  if (!boundaryRejoin) {
    return null;
  }

  for (let attempt = 1; attempt <= MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
    const spacing = attempt * ROUTING_MARGIN;
    const channelY = sourceTop
      ? Math.min(start.y, end.y) - spacing
      : Math.max(start.y, end.y) + spacing;
    const rejoinRoute = cleanPoints([
      start,
      point(start.x, channelY),
      point(end.x, channelY),
      end
    ]);

    if (router.isClear(rejoinRoute)) {
      return rejoinRoute;
    }
  }

  return null;
}

function tryFeedbackDockCandidates(
    {
      flow,
      isBack,
      policy,
      router,
      routedConnections,
      shapes,
      source,
      target
    }: Routing,
    extents: { minX: number; minY: number; maxX: number; maxY: number }
): MaybeRoute {
  if (!isBack || !policy.compactFeedbackNodes?.has(flow.sourceRef)) {
    return null;
  }

  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const sourceDocks = {
    east: point(source.x + source.width, sourceCenterY),
    south: point(sourceCenterX, source.y + source.height),
    west: point(source.x, sourceCenterY),
    north: point(sourceCenterX, source.y)
  };
  const targetSouth = point(targetCenterX, target.y + target.height);
  const targetNorth = point(targetCenterX, target.y);
  const preferTop = sourceCenterY < target.y + target.height / 2;
  const feedbackRouter = policy.adaptiveFeedbackSide
    ? createSequenceFlowRouter(
      shapes,
      flow.sourceRef,
      flow.targetRef,
      routedConnections.filter(connection => {
        return connection.flow.targetRef !== flow.targetRef;
      }),
      { maxVisibilityPoints: MAX_VISIBILITY_GRAPH_POINTS }
    )
    : router;
  const exposure = {
    east: extents.maxX - sourceDocks.east.x,
    south: extents.maxY - sourceDocks.south.y,
    west: sourceDocks.west.x - extents.minX,
    north: sourceDocks.north.y - extents.minY
  };
  const candidates: FeedbackRouteCandidate[] = [];

  for (let attempt = 1; attempt <= MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
    const spacing = attempt * ROUTING_MARGIN;
    const bottomY = extents.maxY + spacing;
    const topY = extents.minY - spacing;
    const eastX = extents.maxX + spacing;
    const westX = extents.minX - spacing;
    const routeCandidates = [
      {
        exposure: exposure.east,
        order: 0,
        top: false,
        points: cleanPoints([
          sourceDocks.east,
          point(eastX, sourceDocks.east.y),
          point(eastX, bottomY),
          point(targetSouth.x, bottomY),
          targetSouth
        ])
      },
      {
        exposure: exposure.south,
        order: 1,
        top: false,
        points: cleanPoints([
          sourceDocks.south,
          point(sourceDocks.south.x, bottomY),
          point(targetSouth.x, bottomY),
          targetSouth
        ])
      },
      {
        exposure: exposure.west,
        order: 2,
        top: false,
        points: cleanPoints([
          sourceDocks.west,
          point(westX, sourceDocks.west.y),
          point(westX, bottomY),
          point(targetSouth.x, bottomY),
          targetSouth
        ])
      },
      {
        exposure: exposure.north,
        order: 3,
        top: true,
        points: cleanPoints([
          sourceDocks.north,
          point(sourceDocks.north.x, topY),
          point(targetNorth.x, topY),
          targetNorth
        ])
      },
      ...(policy.adaptiveFeedbackSide ? [ {
        exposure: exposure.east,
        order: 4,
        top: true,
        points: cleanPoints([
          sourceDocks.east,
          point(eastX, sourceDocks.east.y),
          point(eastX, topY),
          point(targetNorth.x, topY),
          targetNorth
        ])
      } ] : [])
    ];

    for (const candidate of routeCandidates) {
      if (!feedbackRouter.isClear(candidate.points)) {
        continue;
      }

      const xs = candidate.points.map(({ x }) => x);
      const ys = candidate.points.map(({ y }) => y);
      const footprintExpansion =
        Math.max(0, extents.minX - Math.min(...xs)) +
        Math.max(0, Math.max(...xs) - extents.maxX) +
        Math.max(0, extents.minY - Math.min(...ys)) +
        Math.max(0, Math.max(...ys) - extents.maxY);

      candidates.push({
        points: candidate.points,
        score: [
          ...(policy.adaptiveFeedbackSide
            ? [ candidate.top === preferTop ? 0 : 1 ]
            : []),
          candidate.exposure,
          footprintExpansion,
          Math.max(0, candidate.points.length - 2),
          routeLength(candidate.points),
          candidate.order
        ]
      });
    }

    if (candidates.length) {
      break;
    }
  }

  return candidates.sort((a, b) => compareRouteScores(a.score, b.score))[0]?.points || null;
}

function compareRouteScores(a: number[], b: number[]): number {
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
}

function tryFeedbackChannels(
    {
      end,
      feedback,
      longForward,
      router,
      start
    }: Routing,
    extents: { maxY: number }): MaybeRoute {
  if (!feedback && !longForward) {
    return null;
  }

  for (let attempt = 1; attempt <= MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
    const channelY = extents.maxY + attempt * ROUTING_MARGIN;
    const backRoute = cleanPoints([
      start,
      point(start.x, channelY),
      point(end.x, channelY),
      end
    ]);

    if (router.isClear(backRoute)) {
      return backRoute;
    }
  }

  return null;
}

function tryPreferredChannel(routing: Routing, extents: { minY: number; maxY: number }): MaybeRoute {
  const {
    end,
    isBack,
    router,
    sourceBoundary,
    sourceTop,
    start
  } = routing;
  const channelY = isBack
    ? extents.maxY + ROUTING_MARGIN
    : sourceBoundary
      ? end.y
      : sourceTop
        ? Math.min(start.y, end.y) - ROUTING_MARGIN
        : Math.max(start.y, end.y) + ROUTING_MARGIN;
  const leadX = isBack
    ? Math.min(start.x, end.x) - ROUTING_MARGIN
    : Math.round((start.x + end.x) / 2);
  const preferred = cleanPoints([
    start,
    point(sourceBoundary ? start.x : leadX, start.y),
    point(sourceBoundary ? start.x : leadX, channelY),
    point(end.x, channelY),
    end
  ]);

  return router.isClear(preferred) ? preferred : null;
}

function tryVisibilityRoutes({
  clearRouter,
  end,
  router,
  start
}: Routing) {
  return router.findRoute(start, end) || clearRouter.findRoute(start, end);
}

function tryOuterRoutes({
  clearRouter,
  end,
  isBack,
  router,
  shapes,
  sourceBoundary,
  sourceTop,
  start
}: Routing) {
  return findOuterRoute(
    start,
    end,
    shapes,
    router,
    isBack,
    sourceBoundary,
    sourceTop
  ) || findOuterRoute(
    start,
    end,
    shapes,
    clearRouter,
    isBack,
    sourceBoundary,
    sourceTop
  );
}

function routePerimeterOrThrow({
  clearRouter,
  flow,
  router,
  shapes,
  source,
  target
}: Routing) {
  const route = findPerimeterRoute(
    source,
    target,
    shapes,
    router
  ) || findPerimeterRoute(
    source,
    target,
    shapes,
    clearRouter
  );

  if (!route) {
    throw new LayoutError(
      'ROUTING_FAILED',
      flow.id,
      `No legal orthogonal route could be found without crossing a shape (${flow.id}).`
    );
  }

  return route;
}

function routeSelfLoop(flow: FlowEdge, source: Rect, target: Rect, clearRouter: Router): Point[] {
  const start = point(source.x + source.width / 2, source.y + source.height);
  const end = point(target.x, target.y + target.height / 2);

  for (let attempt = 1; attempt <= MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
    const spacing = attempt * ROUTING_MARGIN;
    const channelX = target.x - spacing;
    const channelY = Math.max(
      source.y + source.height,
      target.y + target.height
    ) + spacing;
    const candidate = [
      start,
      point(start.x, channelY),
      point(channelX, channelY),
      point(channelX, end.y),
      end
    ];

    if (clearRouter.isClear(candidate)) {
      return candidate;
    }
  }

  throw new LayoutError(
    'ROUTING_FAILED',
    flow.id,
    `No legal self-loop route could be found without crossing a shape (${flow.id}).`
  );
}

function findClearVerticalDock(target: Rect, onTop: boolean, clearRouter: Router): Point {
  const y = onTop ? target.y : target.y + target.height;
  const candidates = CLEAR_DOCK_X_FRACTIONS.map(offset => {
    return point(target.x + target.width * offset, y);
  });

  return candidates.find(candidate => {
    const outside = point(candidate.x, candidate.y + (onTop ? -ROUTING_MARGIN : ROUTING_MARGIN));

    return clearRouter.isClear([ outside, candidate ]);
  }) || candidates[0];
}

function findLocalUBypass(flow: FlowEdge, start: Point, end: Point, shapes: RouterShape[], policy: RoutingPolicy, routedConnections: RoutedConnection[]): MaybeRoute {
  const sourceElement = flow.sourceRef;
  const targetElement = flow.targetRef;
  const shapeByElement: ShapeByElement = new Map(shapes.map(({ element, rect }) => [ element, rect ]));
  const source = getRequired(shapeByElement.get(sourceElement));
  const target = getRequired(shapeByElement.get(targetElement));
  const centerY = source.y + source.height / 2;
  const directStart = source.x < target.x
    ? point(source.x + source.width, centerY)
    : point(source.x, centerY);
  const directEnd = source.x < target.x
    ? point(target.x, centerY)
    : point(target.x + target.width, centerY);
  const blockers = shapes.filter(({ element, rect }) => {
    return element !== sourceElement &&
      element !== targetElement &&
      segmentEntersRect(
        directStart,
        directEnd,
        inset(rect, ROUTE_COLLISION_TOLERANCE)
      );
  });
  const nearestBottom = Math.max(
    source.y + source.height,
    target.y + target.height,
    ...blockers.map(({ rect }) => rect.y + rect.height)
  );
  const uShapeEdges = uShapeCandidates(shapes, policy, shapeByElement);
  const depth = uShapeDepth(flow, shapeByElement, uShapeEdges);
  const isolated = !hasOverlappingUShape(
    flow,
    shapeByElement,
    uShapeEdges
  );
  const balancedDefault = sourceElement.default === flow && isolated;
  const nearestTop = Math.min(
    source.y,
    target.y,
    ...blockers.map(({ rect }) => rect.y)
  );
  const topStart = point(source.x + source.width / 2, source.y);
  const topEnd = point(target.x + target.width / 2, target.y);
  const localURouter = createSequenceFlowRouter(
    shapes,
    sourceElement,
    targetElement,
    routedConnections
  );
  const localUClearRouter = createSequenceFlowRouter(
    shapes,
    sourceElement,
    targetElement,
    []
  );

  if (!balancedDefault) {
    return findClearLocalUChannel(
      start,
      end,
      nearestBottom,
      1,
      depth,
      localURouter
    ) || findClearLocalUChannel(
      start,
      end,
      nearestBottom,
      1,
      depth,
      localUClearRouter
    ) || findClearLocalUChannel(
      topStart,
      topEnd,
      nearestTop,
      -1,
      depth,
      localURouter
    ) || findClearLocalUChannel(
      topStart,
      topEnd,
      nearestTop,
      -1,
      depth,
      localUClearRouter
    );
  }

  for (const candidateRouter of [ localURouter, localUClearRouter ]) {
    const bottom = findClearLocalUChannel(
      start,
      end,
      nearestBottom,
      1,
      depth,
      candidateRouter
    );
    const top = findClearLocalUChannel(
      topStart,
      topEnd,
      nearestTop,
      -1,
      depth,
      candidateRouter
    );
    const candidates = [ top, bottom ].filter((route): route is Point[] => !!route);

    if (candidates.length) {
      return candidates.sort((a, b) => routeLength(a) - routeLength(b))[0];
    }
  }

  return null;
}

function findClearLocalUChannel(start: Point, end: Point, nearest: number, direction: number, depth: number, router: Router): MaybeRoute {
  for (let attempt = 0; attempt < MAX_LOCAL_U_CHANNEL_ATTEMPTS; attempt++) {
    const channelY = nearest + direction * (depth + attempt) * ROUTING_MARGIN;
    const channelStart = point(start.x, channelY);
    const channelEnd = point(end.x, channelY);
    const candidate: BpmnPath = {
      sections: [
        {
          role: 'source-dock',
          points: [ start, channelStart ]
        },
        {
          role: 'channel',
          points: [ channelStart, channelEnd ]
        },
        {
          role: 'target-dock',
          points: [ channelEnd, end ]
        }
      ]
    };

    if (router.isBpmnPathClear(candidate, {
      channelClearance: LOCAL_U_OBSTACLE_CLEARANCE,
      dockingClearance: LOCAL_U_OBSTACLE_CLEARANCE,
      dockingCollisionTolerance: 0
    })) {
      return cleanPoints(flattenBpmnPath(candidate));
    }
  }

  return null;
}

function uShapeDepth(flow: FlowEdge, shapeByElement: ShapeByElement, candidates: FlowEdge[]): number {
  const memo = new Map<FlowEdge, number>();
  const depth = (edge: FlowEdge): number => {
    if (memo.has(edge)) {
      return getRequired(memo.get(edge));
    }

    const [ left, right ] = uShapeSpan(edge, shapeByElement);
    const nested = candidates.filter(other => {
      if (other === edge) {
        return false;
      }

      const otherSource = getRequired(shapeByElement.get(other.sourceRef));
      const [ otherLeft ] = uShapeSpan(other, shapeByElement);

      return otherSource.y + otherSource.height / 2 ===
          getRequired(shapeByElement.get(edge.sourceRef)).y + getRequired(shapeByElement.get(edge.sourceRef)).height / 2 &&
        otherLeft > left && otherLeft < right;
    });
    const value = 1 + Math.max(0, ...nested.map(depth));

    memo.set(edge, value);
    return value;
  };

  return depth(flow);
}

function hasOverlappingUShape(flow: FlowEdge, shapeByElement: ShapeByElement, candidates: FlowEdge[]): boolean {
  const source = getRequired(shapeByElement.get(flow.sourceRef));
  const [ left, right ] = uShapeSpan(flow, shapeByElement);

  return candidates.some(other => {
    if (other === flow) {
      return false;
    }

    const otherSource = getRequired(shapeByElement.get(other.sourceRef));
    const [ otherLeft, otherRight ] = uShapeSpan(other, shapeByElement);

    return otherSource.y + otherSource.height / 2 ===
        source.y + source.height / 2 &&
      otherLeft < right &&
      otherRight > left;
  });
}

function uShapeCandidates(shapes: RouterShape[], policy: RoutingPolicy, shapeByElement: ShapeByElement): FlowEdge[] {
  return policy.graphEdges.filter(edge => {
    const source = shapeByElement.get(edge.sourceRef);
    const target = shapeByElement.get(edge.targetRef);

    if (!source || !target ||
        source.y + source.height / 2 !== target.y + target.height / 2) {
      return false;
    }

    if (policy.backEdges?.has(edge)) {
      return true;
    }

    const start = point(source.x + source.width, source.y + source.height / 2);
    const end = point(target.x, target.y + target.height / 2);

    return target.x >= source.x &&
      !segmentIsClear(start, end, shapes, edge.sourceRef, edge.targetRef, []);
  });
}

function uShapeSpan(edge: FlowEdge, shapeByElement: ShapeByElement): [ number, number ] {
  const source = getRequired(shapeByElement.get(edge.sourceRef));
  const target = getRequired(shapeByElement.get(edge.targetRef));

  return [
    Math.min(source.x, target.x),
    Math.max(source.x + source.width, target.x + target.width)
  ];
}

function findOuterRoute(start: Point, end: Point, shapes: RouterShape[], router: Router, isBack: boolean, sourceBoundary: boolean, sourceTop: boolean): MaybeRoute {
  const extents = getShapeExtents(shapes);

  for (let attempt = 1; attempt <= MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
    const spacing = ROUTING_MARGIN * attempt;
    const channelY = sourceBoundary && sourceTop
      ? extents.minY - spacing
      : extents.maxY + spacing;
    const exitX = isBack ? start.x - spacing : start.x + spacing;
    const entryX = isBack ? end.x + spacing : end.x - spacing;
    const candidate = cleanPoints([
      start,
      point(sourceBoundary ? start.x : exitX, start.y),
      point(sourceBoundary ? start.x : exitX, channelY),
      point(entryX, channelY),
      point(entryX, end.y),
      end
    ]);
    if (router.isClear(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findPerimeterRoute(source: Rect, target: Rect, shapes: RouterShape[], router: Router): MaybeRoute {
  const extents = getShapeExtents(shapes);
  const corners = [
    point(extents.minX - ROUTING_MARGIN, extents.minY - ROUTING_MARGIN),
    point(extents.maxX + ROUTING_MARGIN, extents.minY - ROUTING_MARGIN),
    point(extents.minX - ROUTING_MARGIN, extents.maxY + ROUTING_MARGIN),
    point(extents.maxX + ROUTING_MARGIN, extents.maxY + ROUTING_MARGIN)
  ];

  for (const corner of corners) {
    const sourceLegs = outerLegs(source, corner);
    const targetLegs = outerLegs(target, corner);

    for (const sourceLeg of sourceLegs) {
      for (const targetLeg of targetLegs) {
        const route = cleanPoints([
          ...sourceLeg,
          ...targetLeg.slice().reverse().slice(1)
        ]);

        if (router.isClear(route)) {
          return route;
        }
      }
    }
  }

  return null;
}

function outerLegs(rect: Rect, corner: Point): Point[][] {
  const horizontalPort = point(
    corner.x < rect.x ? rect.x : rect.x + rect.width,
    rect.y + rect.height / 2
  );
  const verticalPort = point(
    rect.x + rect.width / 2,
    corner.y < rect.y ? rect.y : rect.y + rect.height
  );

  return [
    [ horizontalPort, point(corner.x, horizontalPort.y), corner ],
    [ verticalPort, point(verticalPort.x, corner.y), corner ]
  ];
}

function segmentIsClear(a: Point, b: Point, shapes: RouterShape[], sourceElement: BpmnElement, targetElement: BpmnElement, routedConnections: RoutedConnection[], collisionTolerance = ROUTE_COLLISION_TOLERANCE, allowPerpendicularCrossings = false): boolean {
  return createSequenceFlowRouter(
    shapes,
    sourceElement,
    targetElement,
    routedConnections,
    {
      collisionTolerance,
      allowPerpendicularCrossings
    }
  ).isClear([ a, b ]);
}

function createSequenceFlowRouter(shapes: RouterShape[], sourceElement: BpmnElement, targetElement: BpmnElement, routedConnections: RoutedConnection[], options: { collisionTolerance?: number; obstacleClearance?: number; allowPerpendicularCrossings?: boolean; maxVisibilityPoints?: number } = {}): Router {
  return createBpmnOrthogonalRouter({
    shapes,
    sourceElement,
    targetElement,
    routedConnections,
    ...options
  });
}
