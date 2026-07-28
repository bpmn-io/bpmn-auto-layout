import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';
import {
  ROUTING_MARGIN,
  MAX_ROUTE_SEARCH_ATTEMPTS,
  MAX_LOCAL_U_CHANNEL_ATTEMPTS,
  ROUTE_OBSTACLE_INSET,
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
  createBpmnOrthogonalRouter
} from '../../routing/BpmnOrthogonalRouting.js';

// Preferred fractional x-offsets (in that order) when searching for a clear
// vertical rejoin dock along a target's width.
const CLEAR_DOCK_X_FRACTIONS = [ 0.5, 0.25, 0.75 ];

export function routeConnection(flow, source, target, shapes, routedConnections, policy) {
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

function isSelfLoop(flow) {
  return flow.sourceRef === flow.targetRef ||
    (
      is(flow.sourceRef, 'bpmn:BoundaryEvent') &&
      flow.sourceRef.attachedToRef === flow.targetRef
    );
}

function classifyConnection(flow, source, target, clearRouter, policy) {
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
    !clearRouter.isSegmentClear(forwardStart, forwardEnd);
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
    flow,
    source,
    target,
    clearRouter,
    classification) {
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

function tryPreferredConnectionRoutes(routing) {
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
}) {
  if (
    !isBack &&
    start.y === end.y &&
    router.isSegmentClear(start, end)
  ) {
    return [ start, end ];
  }

  return null;
}

function tryBranchRoute(routing) {
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

function tryCrossBandRoute(routing) {
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
}) {
  if (!longForward && (!feedback || sourceBoundary)) {
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

function routeConnectionWithFallbacks(routing) {
  const extents = getShapeExtents(routing.shapes);

  return tryBoundaryRejoinChannels(routing) ||
    tryFeedbackChannels(routing, extents) ||
    tryPreferredChannel(routing, extents) ||
    tryVisibilityRoutes(routing) ||
    tryOuterRoutes(routing) ||
    routePerimeterOrThrow(routing);
}

function tryBoundaryRejoinChannels({
  boundaryRejoin,
  end,
  router,
  sourceTop,
  start
}) {
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

function tryFeedbackChannels(
    {
      end,
      feedback,
      longForward,
      router,
      start
    },
    extents) {
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

function tryPreferredChannel(routing, extents) {
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
}) {
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
}) {
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
}) {
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

function routeSelfLoop(flow, source, target, clearRouter) {
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

function findClearVerticalDock(target, onTop, clearRouter) {
  const y = onTop ? target.y : target.y + target.height;
  const candidates = CLEAR_DOCK_X_FRACTIONS.map(offset => {
    return point(target.x + target.width * offset, y);
  });

  return candidates.find(candidate => {
    const outside = point(candidate.x, candidate.y + (onTop ? -ROUTING_MARGIN : ROUTING_MARGIN));

    return clearRouter.isSegmentClear(outside, candidate);
  }) || candidates[0];
}

function findLocalUBypass(
    flow,
    start,
    end,
    shapes,
    policy,
    routedConnections) {
  const sourceElement = flow.sourceRef;
  const targetElement = flow.targetRef;
  const shapeByElement = new Map(shapes.map(({ element, rect }) => [ element, rect ]));
  const source = shapeByElement.get(sourceElement);
  const target = shapeByElement.get(targetElement);
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
      segmentEntersRect(directStart, directEnd, inset(rect, ROUTE_OBSTACLE_INSET));
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
  const expandedRouter = createSequenceFlowRouter(
    shapes,
    sourceElement,
    targetElement,
    routedConnections,
    { obstacleInset: -LOCAL_U_OBSTACLE_CLEARANCE }
  );
  const expandedClearRouter = createSequenceFlowRouter(
    shapes,
    sourceElement,
    targetElement,
    [],
    { obstacleInset: -LOCAL_U_OBSTACLE_CLEARANCE }
  );

  if (!balancedDefault) {
    return findClearLocalUChannel(
      start,
      end,
      nearestBottom,
      1,
      depth,
      expandedRouter
    ) || findClearLocalUChannel(
      start,
      end,
      nearestBottom,
      1,
      depth,
      expandedClearRouter
    ) || findClearLocalUChannel(
      topStart,
      topEnd,
      nearestTop,
      -1,
      depth,
      expandedRouter
    ) || findClearLocalUChannel(
      topStart,
      topEnd,
      nearestTop,
      -1,
      depth,
      expandedClearRouter
    );
  }

  for (const candidateRouter of [ expandedRouter, expandedClearRouter ]) {
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
    const candidates = [ top, bottom ].filter(Boolean);

    if (candidates.length) {
      return candidates.sort((a, b) => routeLength(a) - routeLength(b))[0];
    }
  }

  return null;
}

function findClearLocalUChannel(
    start,
    end,
    nearest,
    direction,
    depth,
    router) {
  for (let attempt = 0; attempt < MAX_LOCAL_U_CHANNEL_ATTEMPTS; attempt++) {
    const channelY = nearest + direction * (depth + attempt) * ROUTING_MARGIN;
    const candidate = cleanPoints([
      start,
      point(start.x, channelY),
      point(end.x, channelY),
      end
    ]);

    if (router.isClear(candidate)) {
      return candidate;
    }
  }

  return null;
}

function uShapeDepth(flow, shapeByElement, candidates) {
  const memo = new Map();
  const depth = edge => {
    if (memo.has(edge)) {
      return memo.get(edge);
    }

    const [ left, right ] = uShapeSpan(edge, shapeByElement);
    const nested = candidates.filter(other => {
      if (other === edge) {
        return false;
      }

      const otherSource = shapeByElement.get(other.sourceRef);
      const [ otherLeft ] = uShapeSpan(other, shapeByElement);

      return otherSource.y + otherSource.height / 2 ===
          shapeByElement.get(edge.sourceRef).y + shapeByElement.get(edge.sourceRef).height / 2 &&
        otherLeft > left && otherLeft < right;
    });
    const value = 1 + Math.max(0, ...nested.map(depth));

    memo.set(edge, value);
    return value;
  };

  return depth(flow);
}

function hasOverlappingUShape(flow, shapeByElement, candidates) {
  const source = shapeByElement.get(flow.sourceRef);
  const [ left, right ] = uShapeSpan(flow, shapeByElement);

  return candidates.some(other => {
    if (other === flow) {
      return false;
    }

    const otherSource = shapeByElement.get(other.sourceRef);
    const [ otherLeft, otherRight ] = uShapeSpan(other, shapeByElement);

    return otherSource.y + otherSource.height / 2 ===
        source.y + source.height / 2 &&
      otherLeft < right &&
      otherRight > left;
  });
}

function uShapeCandidates(shapes, policy, shapeByElement) {
  return (policy.graphEdges || []).filter(edge => {
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

function uShapeSpan(edge, shapeByElement) {
  const source = shapeByElement.get(edge.sourceRef);
  const target = shapeByElement.get(edge.targetRef);

  return [
    Math.min(source.x, target.x),
    Math.max(source.x + source.width, target.x + target.width)
  ];
}

function findOuterRoute(
    start,
    end,
    shapes,
    router,
    isBack,
    sourceBoundary,
    sourceTop) {
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

function findPerimeterRoute(source, target, shapes, router) {
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

function outerLegs(rect, corner) {
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

function segmentIsClear(
    a,
    b,
    shapes,
    sourceElement,
    targetElement,
    routedConnections,
    obstacleInset = ROUTE_OBSTACLE_INSET,
    allowPerpendicularCrossings = false) {
  return createSequenceFlowRouter(
    shapes,
    sourceElement,
    targetElement,
    routedConnections,
    {
      obstacleInset,
      allowPerpendicularCrossings
    }
  ).isSegmentClear(a, b);
}

function createSequenceFlowRouter(
    shapes,
    sourceElement,
    targetElement,
    routedConnections,
    options = {}) {
  return createBpmnOrthogonalRouter({
    shapes,
    sourceElement,
    targetElement,
    routedConnections,
    ...options
  });
}
