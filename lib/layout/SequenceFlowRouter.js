import { is } from '../di/DiUtil.js';
import { LayoutError } from '../LayoutError.js';
import { ROUTING_MARGIN, MAX_ROUTE_SEARCH_ATTEMPTS, MAX_LOCAL_U_CHANNEL_ATTEMPTS, ROUTE_OBSTACLE_INSET, VISIBILITY_GRAPH_TURN_PENALTY } from './Constants.js';
import {
  point,
  cleanPoints,
  toSegments,
  pointInRect,
  inset,
  segmentEntersRect,
  collinearOverlap,
  segmentsProperlyCross,
  getShapeExtents,
  routeLength,
  manhattan
} from './LayoutUtil.js';

// Preferred fractional x-offsets (in that order) when searching for a clear
// vertical rejoin dock along a target's width.
const CLEAR_DOCK_X_FRACTIONS = [ 0.5, 0.25, 0.75 ];

export function routeConnection(flow, source, target, shapes, routedConnections, policy) {
  if (flow.sourceRef === flow.targetRef) {
    return routeSelfLoop(flow, source, target, shapes);
  }

  if (is(flow.sourceRef, 'bpmn:BoundaryEvent') &&
      flow.sourceRef.attachedToRef === flow.targetRef) {
    return routeSelfLoop(flow, source, target, shapes);
  }

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
    !segmentIsClear(forwardStart, forwardEnd, shapes, flow.sourceRef, flow.targetRef, []);
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
  let end = feedback || longForward
    ? point(target.x + target.width / 2, target.y + target.height)
    : boundaryRejoin
      ? point(target.x + target.width / 2, sourceTop ? target.y : target.y + target.height)
      : verticalTarget
        ? point(target.x + target.width / 2, targetFromAbove ? target.y : target.y + target.height)
        : isBack
          ? point(target.x + target.width, target.y + target.height / 2)
          : point(target.x, targetDockY);

  if (boundaryRejoin) {
    end = findClearVerticalDock(
      target,
      sourceTop,
      shapes,
      flow.sourceRef,
      flow.targetRef
    );
  }

  if (!isBack && start.y === end.y && segmentIsClear(start, end, shapes, flow.sourceRef, flow.targetRef, routedConnections)) {
    return [ start, end ];
  }

  if (gatewayBranch || boundaryBranch) {
    const branchRoute = cleanPoints([ start, point(start.x, end.y), end ]);

    if (pathIsClear(branchRoute, shapes, flow.sourceRef, flow.targetRef, routedConnections)) {
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

    if (pathIsClear(branchRoute, shapes, flow.sourceRef, flow.targetRef, routedConnections)) {
      return branchRoute;
    }
  }

  if (crossBand) {
    const joinRoute = cleanPoints([ start, point(end.x, start.y), end ]);

    if (pathIsClear(joinRoute, shapes, flow.sourceRef, flow.targetRef, routedConnections)) {
      return joinRoute;
    }
  }

  if (longForward || (feedback && !sourceBoundary)) {
    const localBypass = findLocalUBypass(
      flow,
      start,
      end,
      shapes,
      policy,
      routedConnections
    );

    if (localBypass) {
      return localBypass;
    }
  }

  const extents = getShapeExtents(shapes);

  if (boundaryRejoin) {
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

      if (pathIsClear(rejoinRoute, shapes, flow.sourceRef, flow.targetRef, routedConnections)) {
        return rejoinRoute;
      }
    }
  }

  if (feedback || longForward) {
    for (let attempt = 1; attempt <= MAX_ROUTE_SEARCH_ATTEMPTS; attempt++) {
      const channelY = extents.maxY + attempt * ROUTING_MARGIN;
      const backRoute = cleanPoints([
        start,
        point(start.x, channelY),
        point(end.x, channelY),
        end
      ]);

      if (pathIsClear(backRoute, shapes, flow.sourceRef, flow.targetRef, routedConnections)) {
        return backRoute;
      }
    }
  }

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

  if (pathIsClear(preferred, shapes, flow.sourceRef, flow.targetRef, routedConnections)) {
    return preferred;
  }

  const route = visibilityRoute(start, end, shapes, flow.sourceRef, flow.targetRef, routedConnections) ||
    visibilityRoute(start, end, shapes, flow.sourceRef, flow.targetRef, []);

  if (route) {
    return route;
  }

  const outerRoute = findOuterRoute(
    start,
    end,
    shapes,
    flow.sourceRef,
    flow.targetRef,
    routedConnections,
    isBack,
    sourceBoundary,
    sourceTop
  ) || findOuterRoute(
    start,
    end,
    shapes,
    flow.sourceRef,
    flow.targetRef,
    [],
    isBack,
    sourceBoundary,
    sourceTop
  );

  if (outerRoute) {
    return outerRoute;
  }

  const perimeterRoute = findPerimeterRoute(
    source,
    target,
    shapes,
    flow.sourceRef,
    flow.targetRef,
    routedConnections
  ) || findPerimeterRoute(
    source,
    target,
    shapes,
    flow.sourceRef,
    flow.targetRef,
    []
  );

  if (!perimeterRoute) {
    throw new LayoutError(
      'ROUTING_FAILED',
      flow.id,
      `No legal orthogonal route could be found without crossing a shape (${flow.id}).`
    );
  }

  return perimeterRoute;
}

function routeSelfLoop(flow, source, target, shapes) {
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

    if (pathIsClear(candidate, shapes, flow.sourceRef, flow.targetRef, [])) {
      return candidate;
    }
  }

  throw new LayoutError(
    'ROUTING_FAILED',
    flow.id,
    `No legal self-loop route could be found without crossing a shape (${flow.id}).`
  );
}

function findClearVerticalDock(target, onTop, shapes, sourceElement, targetElement) {
  const y = onTop ? target.y : target.y + target.height;
  const candidates = CLEAR_DOCK_X_FRACTIONS.map(offset => {
    return point(target.x + target.width * offset, y);
  });

  return candidates.find(candidate => {
    const outside = point(candidate.x, candidate.y + (onTop ? -ROUTING_MARGIN : ROUTING_MARGIN));

    return segmentIsClear(outside, candidate, shapes, sourceElement, targetElement, []);
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
  const depth = uShapeDepth(flow, shapes, policy);
  const isolated = !hasOverlappingUShape(flow, shapes, policy);
  const balancedDefault = sourceElement.default === flow && isolated;
  const nearestTop = Math.min(
    source.y,
    target.y,
    ...blockers.map(({ rect }) => rect.y)
  );
  const topStart = point(source.x + source.width / 2, source.y);
  const topEnd = point(target.x + target.width / 2, target.y);

  if (!balancedDefault) {
    return findClearLocalUChannel(
      start,
      end,
      nearestBottom,
      1,
      depth,
      shapes,
      sourceElement,
      targetElement,
      routedConnections
    ) || findClearLocalUChannel(
      start,
      end,
      nearestBottom,
      1,
      depth,
      shapes,
      sourceElement,
      targetElement,
      []
    ) || findClearLocalUChannel(
      topStart,
      topEnd,
      nearestTop,
      -1,
      depth,
      shapes,
      sourceElement,
      targetElement,
      routedConnections
    ) || findClearLocalUChannel(
      topStart,
      topEnd,
      nearestTop,
      -1,
      depth,
      shapes,
      sourceElement,
      targetElement,
      []
    );
  }

  for (const connections of [ routedConnections, [] ]) {
    const bottom = findClearLocalUChannel(
      start,
      end,
      nearestBottom,
      1,
      depth,
      shapes,
      sourceElement,
      targetElement,
      connections
    );
    const top = findClearLocalUChannel(
      topStart,
      topEnd,
      nearestTop,
      -1,
      depth,
      shapes,
      sourceElement,
      targetElement,
      connections
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
    shapes,
    sourceElement,
    targetElement,
    routedConnections) {
  for (let attempt = 0; attempt < MAX_LOCAL_U_CHANNEL_ATTEMPTS; attempt++) {
    const channelY = nearest + direction * (depth + attempt) * ROUTING_MARGIN;
    const candidate = cleanPoints([
      start,
      point(start.x, channelY),
      point(end.x, channelY),
      end
    ]);

    if (pathIsClear(candidate, shapes, sourceElement, targetElement, routedConnections)) {
      return candidate;
    }
  }

  return null;
}

function uShapeDepth(flow, shapes, policy) {
  const shapeByElement = new Map(shapes.map(({ element, rect }) => [ element, rect ]));
  const candidates = uShapeCandidates(shapes, policy, shapeByElement);
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

function hasOverlappingUShape(flow, shapes, policy) {
  const shapeByElement = new Map(shapes.map(({ element, rect }) => [ element, rect ]));
  const source = shapeByElement.get(flow.sourceRef);
  const [ left, right ] = uShapeSpan(flow, shapeByElement);

  return uShapeCandidates(shapes, policy, shapeByElement).some(other => {
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

function findOuterRoute(start, end, shapes, sourceElement, targetElement, routedConnections, isBack, sourceBoundary, sourceTop) {
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
    if (pathIsClear(candidate, shapes, sourceElement, targetElement, routedConnections)) {
      return candidate;
    }
  }

  return null;
}

function findPerimeterRoute(source, target, shapes, sourceElement, targetElement, routedConnections) {
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

        if (pathIsClear(route, shapes, sourceElement, targetElement, routedConnections)) {
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

export function visibilityRoute(start, end, shapes, sourceElement, targetElement, routedConnections) {
  const extents = getShapeExtents(shapes);
  const xs = new Set([ start.x, end.x, extents.minX - ROUTING_MARGIN, extents.maxX + ROUTING_MARGIN ]);
  const ys = new Set([ start.y, end.y, extents.minY - ROUTING_MARGIN, extents.maxY + ROUTING_MARGIN ]);

  for (const { rect } of shapes) {
    xs.add(rect.x - ROUTING_MARGIN);
    xs.add(rect.x + rect.width + ROUTING_MARGIN);
    ys.add(rect.y - ROUTING_MARGIN);
    ys.add(rect.y + rect.height + ROUTING_MARGIN);
  }

  const points = [];

  for (const x of xs) {
    for (const y of ys) {
      const candidate = point(x, y);

      if (!isInsideAny(candidate, shapes, sourceElement, targetElement)) {
        points.push(candidate);
      }
    }
  }

  const startIndex = points.push(start) - 1;
  const endIndex = points.push(end) - 1;
  const distance = Array(points.length).fill(Infinity);
  const previous = Array(points.length).fill(-1);
  const pending = new Set(points.map((_, index) => index));
  distance[startIndex] = 0;

  while (pending.size) {
    const current = [ ...pending ].sort((a, b) => distance[a] - distance[b] || a - b)[0];
    pending.delete(current);

    if (current === endIndex || distance[current] === Infinity) {
      break;
    }

    for (const next of pending) {
      if (points[current].x !== points[next].x && points[current].y !== points[next].y) {
        continue;
      }

      if (!segmentIsClear(points[current], points[next], shapes, sourceElement, targetElement, routedConnections)) {
        continue;
      }

      const candidate = distance[current] + manhattan(points[current], points[next]) + VISIBILITY_GRAPH_TURN_PENALTY;

      if (candidate < distance[next]) {
        distance[next] = candidate;
        previous[next] = current;
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

export function segmentIsClear(a, b, shapes, sourceElement, targetElement, routedConnections) {
  if (a.x === b.x && a.y === b.y) {
    return false;
  }

  for (const { element, rect } of shapes) {
    if (element === sourceElement || element === targetElement) {
      continue;
    }

    if (segmentEntersRect(a, b, inset(rect, ROUTE_OBSTACLE_INSET))) {
      return false;
    }
  }

  return !routedConnections.some(connection => {
    const sharedEndpoint = sharesEndpointChannel(
      connection.flow,
      sourceElement,
      targetElement
    );

    return toSegments(connection.points).some(([ c, d ]) => {
      return segmentsProperlyCross(a, b, c, d) ||
        (!sharedEndpoint && collinearOverlap(a, b, c, d));
    });
  });
}

function sharesEndpointChannel(flow, source, target) {
  return flow.sourceRef === source || flow.targetRef === target;
}

export function pathIsClear(points, shapes, sourceElement, targetElement, routedConnections) {
  return toSegments(points).every(([ a, b ]) => {
    return segmentIsClear(a, b, shapes, sourceElement, targetElement, routedConnections);
  });
}

function isInsideAny(candidate, shapes, sourceElement, targetElement) {
  return shapes.some(({ element, rect }) => {
    return element !== sourceElement && element !== targetElement && pointInRect(candidate, rect);
  });
}
