import { is } from '../../di/DiUtil.js';
import { ROUTING_MARGIN } from '../Constants.js';
import { isArtifact } from '../bpmn/Predicates.js';
import {
  point,
  cleanPoints,
  getExpandedChildEdges,
  getExpandedChildShapes
} from '../geometry/index.js';
import {
  createBpmnOrthogonalRouter
} from '../routing/BpmnOrthogonalRouting.js';
import {
  createOrthogonalRouter
} from '../routing/OrthogonalRouting.js';

import type {
  Point,
  Rect
} from 'diagram-js/lib/util/Types.js';
import type {
  BpmnElement,
  LayoutState,
  Waypoint
} from '../Types.js';

type RoutedConnection = {
  flow: BpmnElement;
  points: Waypoint[];
};

type ConnectionObstacle = {
  element: BpmnElement;
  rect: Rect;
};

type OrthogonalElbow = {
  start: Point;
  corner: Point;
  end: Point;
  sourceVertical: boolean;
  targetVertical: boolean;
};

type PointFactory = (x: number, y: number) => Point;

export function finalizeLayoutConnections(
    layout: LayoutState,
    normalizePlaneDockings = false
): void {
  orientLayoutConnections(layout);

  if (normalizePlaneDockings) {
    orientPlaneDockings(layout);
  }
}

function orientLayoutConnections(layout: LayoutState): void {
  const shapes = new Map([
    ...layout.shapes,
    ...getExpandedChildShapes(layout)
  ]);
  const connections: RoutedConnection[] = [ ...layout.edges ]
    .map(([ flow, points ]) => ({ flow, points }));
  const oriented = new Map();

  for (const [ element, points ] of layout.edges) {
    oriented.set(element, orientDockingPoints(
      element,
      cleanPoints(points),
      shapes,
      connections
    ));
  }

  for (const [ element, points ] of oriented) {
    layout.edges.set(element, points);
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      orientLayoutConnections(child);
    }
  }
}

function getConnectionSource(element: BpmnElement): BpmnElement | undefined {
  if (is(element, 'bpmn:DataAssociation')) {
    return element.sourceRef?.[0];
  }

  if (
    is(element, 'bpmn:Association') ||
    is(element, 'bpmn:MessageFlow') ||
    is(element, 'bpmn:SequenceFlow')
  ) {
    return element.sourceRef;
  }
}

function getConnectionTarget(element: BpmnElement): BpmnElement | undefined {
  if (
    is(element, 'bpmn:Association') ||
    is(element, 'bpmn:DataAssociation') ||
    is(element, 'bpmn:MessageFlow') ||
    is(element, 'bpmn:SequenceFlow')
  ) {
    return element.targetRef;
  }
}

function orientDockingPoints(
    element: BpmnElement,
    points: Waypoint[],
    shapes: Map<BpmnElement, Rect>,
    routedConnections: RoutedConnection[]
): Waypoint[] {
  if (is(element, 'bpmn:Association') || is(element, 'bpmn:DataAssociation')) {
    return points;
  }

  const source = getConnectionSource(element);
  const target = getConnectionTarget(element);
  const sourceBounds = source ? shapes.get(source) : undefined;
  const targetBounds = target ? shapes.get(target) : undefined;
  const boundaryRoute = sourceBounds && targetBounds
    ? enforceBoundaryVerticalExit(
      element,
      source,
      points,
      sourceBounds,
      targetBounds,
      shapes,
      routedConnections
    )
    : points;
  const elbowRoute = sourceBounds && targetBounds
    ? flipTangentElbow(
      element,
      source,
      boundaryRoute,
      sourceBounds,
      targetBounds,
      shapes
    )
    : boundaryRoute;
  const route = sourceBounds && targetBounds
    ? centerOrthogonalElbow(
      element,
      source,
      elbowRoute,
      sourceBounds,
      targetBounds,
      shapes,
      routedConnections
    )
    : elbowRoute;
  const oriented = route.map(({ x, y }) => point(x, y));

  if (sourceBounds) {
    orientPlaneEdgeDocking(oriented, sourceBounds, true, true);
  }
  if (targetBounds) {
    orientPlaneEdgeDocking(oriented, targetBounds, false, true);
  }

  return cleanPoints(oriented);
}

function enforceBoundaryVerticalExit(
    element: BpmnElement,
    sourceElement: BpmnElement | undefined,
    points: Waypoint[],
    sourceBounds: Rect,
    targetBounds: Rect,
    shapes: Map<BpmnElement, Rect>,
    routedConnections: RoutedConnection[]
): Waypoint[] {
  if (!is(sourceElement, 'bpmn:BoundaryEvent') || points.length < 2) {
    return points;
  }

  const host = sourceElement.attachedToRef &&
    shapes.get(sourceElement.attachedToRef);
  const sourceCenterY = sourceBounds.y + sourceBounds.height / 2;
  const sourceTop = host &&
    Math.abs(sourceCenterY - host.y) <
    Math.abs(sourceCenterY - (host.y + host.height));
  const sourceDock = point(
    sourceBounds.x + sourceBounds.width / 2,
    sourceTop ? sourceBounds.y : sourceBounds.y + sourceBounds.height
  );
  const direction = sourceTop ? -1 : 1;

  if (
    points[0].x === sourceDock.x &&
    points[0].y === sourceDock.y &&
    points[1].x === sourceDock.x &&
    Math.sign(points[1].y - sourceDock.y) === direction
  ) {
    return points;
  }

  const stub = point(sourceDock.x, sourceDock.y + direction * ROUTING_MARGIN);
  const targetDock = facingDock(sourceDock, targetBounds);
  const obstacles = connectionObstacles(shapes);
  const targetDocks = [
    targetDock,
    oppositeDock(targetDock, targetBounds)
  ];
  let fallback = null;
  const router = createBpmnOrthogonalRouter({
    shapes: obstacles,
    sourceElement,
    targetElement: getConnectionTarget(element),
    routedConnections: routedConnections.filter(({ flow }) => flow !== element)
  });
  const clearRouter = createBpmnOrthogonalRouter({
    shapes: obstacles,
    sourceElement,
    targetElement: getConnectionTarget(element)
  });

  for (const candidateDock of targetDocks) {
    const targetStub = outwardDockingStub(candidateDock, targetBounds);
    const route = router.findRoute(stub, targetStub) ||
      clearRouter.findRoute(stub, targetStub);

    if (!route) {
      continue;
    }

    const candidate = cleanPoints([ sourceDock, ...route, candidateDock ]);

    fallback ||= candidate;

    if (!hasUTurn(candidate)) {
      return candidate;
    }
  }

  return fallback || points;
}

function outwardDockingStub(dock: Point, rect: Rect): Point {
  if (dock.x === rect.x) {
    return point(dock.x - ROUTING_MARGIN, dock.y);
  }
  if (dock.x === rect.x + rect.width) {
    return point(dock.x + ROUTING_MARGIN, dock.y);
  }
  if (dock.y === rect.y) {
    return point(dock.x, dock.y - ROUTING_MARGIN);
  }

  return point(dock.x, dock.y + ROUTING_MARGIN);
}

function oppositeDock(dock: Point, rect: Rect): Point {
  if (dock.x === rect.x) {
    return point(rect.x + rect.width, rect.y + rect.height / 2);
  }
  if (dock.x === rect.x + rect.width) {
    return point(rect.x, rect.y + rect.height / 2);
  }
  if (dock.y === rect.y) {
    return point(rect.x + rect.width / 2, rect.y + rect.height);
  }

  return point(rect.x + rect.width / 2, rect.y);
}

function hasUTurn(points: Point[]): boolean {
  for (let index = 1; index < points.length - 1; index++) {
    const incomingX = points[index].x - points[index - 1].x;
    const incomingY = points[index].y - points[index - 1].y;
    const outgoingX = points[index + 1].x - points[index].x;
    const outgoingY = points[index + 1].y - points[index].y;
    const cross = incomingX * outgoingY - incomingY * outgoingX;
    const dot = incomingX * outgoingX + incomingY * outgoingY;

    if (cross === 0 && dot < 0) {
      return true;
    }
  }

  return false;
}

function facingDock(source: Point, rect: Rect): Point {
  if (source.x < rect.x) {
    return point(rect.x, rect.y + rect.height / 2);
  }
  if (source.x > rect.x + rect.width) {
    return point(rect.x + rect.width, rect.y + rect.height / 2);
  }
  if (source.y < rect.y) {
    return point(rect.x + rect.width / 2, rect.y);
  }
  return point(rect.x + rect.width / 2, rect.y + rect.height);
}

function centerOrthogonalElbow(
    element: BpmnElement,
    sourceElement: BpmnElement | undefined,
    points: Waypoint[],
    sourceBounds: Rect,
    targetBounds: Rect,
    shapes: Map<BpmnElement, Rect>,
    routedConnections: RoutedConnection[]
): Waypoint[] {
  const elbow = classifyOrthogonalElbow(element, points);

  if (!elbow) {
    return points;
  }

  const centered = createCenteredElbowRoute(
    elbow,
    sourceBounds,
    targetBounds
  );
  const obstacles = connectionObstacles(shapes);

  if (elbowRouteIsClear(
    centered,
    element,
    sourceElement,
    obstacles,
    routedConnections
  )) {
    return centered;
  }

  const alternatives = createAlternateElbowRoutes(
    elbow,
    sourceBounds,
    targetBounds,
    centered
  );
  const uncrossed = selectClearElbowRoute(
    [ alternatives.bypass, alternatives.transposed ],
    element,
    sourceElement,
    obstacles,
    routedConnections
  );

  if (uncrossed) {
    return uncrossed;
  }

  const crossingAllowed = selectClearElbowRoute(
    [ centered, alternatives.bypass, alternatives.transposed ],
    element,
    sourceElement,
    obstacles,
    [],
    null
  );

  if (crossingAllowed) {
    return crossingAllowed;
  }

  return routeElbowAroundObstacles(
    element,
    sourceElement,
    sourceBounds,
    targetBounds,
    obstacles,
    points
  );
}

function classifyOrthogonalElbow(
    element: BpmnElement,
    points: Waypoint[]
): OrthogonalElbow | null {
  if (!is(element, 'bpmn:SequenceFlow') || points.length !== 3) {
    return null;
  }

  const [ start, corner, end ] = points;
  const sourceVertical = start.x === corner.x && start.y !== corner.y;
  const sourceHorizontal = start.y === corner.y && start.x !== corner.x;
  const targetVertical = end.x === corner.x && end.y !== corner.y;
  const targetHorizontal = end.y === corner.y && end.x !== corner.x;

  if (!(
    (sourceVertical && targetHorizontal) ||
    (sourceHorizontal && targetVertical)
  )) {
    return null;
  }

  return {
    start,
    corner,
    end,
    sourceVertical,
    targetVertical
  };
}

function createCenteredElbowRoute(
    elbow: OrthogonalElbow,
    sourceBounds: Rect,
    targetBounds: Rect
): Waypoint[] {
  const { start, corner, end, sourceVertical, targetVertical } = elbow;
  const sourceDock = sourceVertical
    ? point(
      sourceBounds.x + sourceBounds.width / 2,
      corner.y < start.y
        ? sourceBounds.y
        : sourceBounds.y + sourceBounds.height
    )
    : point(
      corner.x < start.x
        ? sourceBounds.x
        : sourceBounds.x + sourceBounds.width,
      sourceBounds.y + sourceBounds.height / 2
    );
  const targetDock = targetVertical
    ? point(
      targetBounds.x + targetBounds.width / 2,
      corner.y < end.y
        ? targetBounds.y
        : targetBounds.y + targetBounds.height
    )
    : point(
      corner.x < end.x
        ? targetBounds.x
        : targetBounds.x + targetBounds.width,
      targetBounds.y + targetBounds.height / 2
    );

  return sourceVertical
    ? [ sourceDock, point(sourceDock.x, targetDock.y), targetDock ]
    : [ sourceDock, point(targetDock.x, sourceDock.y), targetDock ];
}

function createAlternateElbowRoutes(
    elbow: OrthogonalElbow,
    sourceBounds: Rect,
    targetBounds: Rect,
    centered: Waypoint[]
): { bypass: Waypoint[]; transposed: Waypoint[] } {
  const { sourceVertical } = elbow;
  const sourceDock = centered[0];
  const sourceCenterX = sourceBounds.x + sourceBounds.width / 2;
  const sourceCenterY = sourceBounds.y + sourceBounds.height / 2;
  const targetCenterX = targetBounds.x + targetBounds.width / 2;
  const targetCenterY = targetBounds.y + targetBounds.height / 2;
  const transposedSourceDock = sourceVertical
    ? point(
      targetCenterX < sourceCenterX
        ? sourceBounds.x
        : sourceBounds.x + sourceBounds.width,
      sourceCenterY
    )
    : point(
      sourceCenterX,
      targetCenterY < sourceCenterY
        ? sourceBounds.y
        : sourceBounds.y + sourceBounds.height
    );
  const alternateTargetDock = sourceVertical
    ? point(
      targetCenterX,
      sourceCenterY < targetCenterY
        ? targetBounds.y
        : targetBounds.y + targetBounds.height
    )
    : point(
      sourceCenterX < targetCenterX
        ? targetBounds.x
        : targetBounds.x + targetBounds.width,
      targetCenterY
    );
  const transposed = sourceVertical
    ? [
      transposedSourceDock,
      point(alternateTargetDock.x, transposedSourceDock.y),
      alternateTargetDock
    ]
    : [
      transposedSourceDock,
      point(transposedSourceDock.x, alternateTargetDock.y),
      alternateTargetDock
    ];
  const direction = sourceVertical
    ? alternateTargetDock.y === targetBounds.y ? -1 : 1
    : alternateTargetDock.x === targetBounds.x ? -1 : 1;
  const channel = sourceVertical
    ? alternateTargetDock.y + direction * ROUTING_MARGIN
    : alternateTargetDock.x + direction * ROUTING_MARGIN;
  const bypass = sourceVertical
    ? [
      sourceDock,
      point(sourceDock.x, channel),
      point(alternateTargetDock.x, channel),
      alternateTargetDock
    ]
    : [
      sourceDock,
      point(channel, sourceDock.y),
      point(channel, alternateTargetDock.y),
      alternateTargetDock
    ];

  return {
    bypass,
    transposed
  };
}

function selectClearElbowRoute(
    candidates: Waypoint[][],
    element: BpmnElement,
    sourceElement: BpmnElement | undefined,
    obstacles: ConnectionObstacle[],
    routedConnections: RoutedConnection[],
    ignoredFlow: BpmnElement | null = element
): Waypoint[] | null {
  const router = createEndpointRouteRouter(
    obstacles,
    sourceElement,
    getConnectionTarget(element),
    routedConnections,
    ignoredFlow
  );

  return candidates.find(candidate => router.isClear(candidate)) || null;
}

function elbowRouteIsClear(
    route: Waypoint[],
    element: BpmnElement,
    sourceElement: BpmnElement | undefined,
    obstacles: ConnectionObstacle[],
    routedConnections: RoutedConnection[],
    ignoredFlow: BpmnElement | null = element
): boolean {
  return endpointRouteIsClear(
    route,
    obstacles,
    sourceElement,
    getConnectionTarget(element),
    routedConnections,
    ignoredFlow
  );
}

function routeElbowAroundObstacles(
    element: BpmnElement,
    sourceElement: BpmnElement | undefined,
    sourceBounds: Rect,
    targetBounds: Rect,
    obstacles: ConnectionObstacle[],
    originalPoints: Waypoint[]
): Waypoint[] {
  const sourceCenter = point(
    sourceBounds.x + sourceBounds.width / 2,
    sourceBounds.y + sourceBounds.height / 2
  );
  const targetCenter = point(
    targetBounds.x + targetBounds.width / 2,
    targetBounds.y + targetBounds.height / 2
  );
  const facingSourceDock = facingDock(targetCenter, sourceBounds);
  const facingTargetDock = facingDock(sourceCenter, targetBounds);
  const sourceStub = outwardDockingStub(facingSourceDock, sourceBounds);
  const targetStub = outwardDockingStub(facingTargetDock, targetBounds);
  const visibilityRouteWithCrossings = createBpmnOrthogonalRouter({
    shapes: obstacles,
    sourceElement,
    targetElement: getConnectionTarget(element)
  }).findRoute(sourceStub, targetStub);

  return visibilityRouteWithCrossings
    ? cleanPoints([
      facingSourceDock,
      ...visibilityRouteWithCrossings,
      facingTargetDock
    ])
    : originalPoints;
}

function endpointRouteIsClear(
    points: Waypoint[],
    obstacles: ConnectionObstacle[],
    sourceElement: BpmnElement | undefined,
    targetElement: BpmnElement | undefined,
    routedConnections: RoutedConnection[],
    ignoredFlow: BpmnElement | null = null
): boolean {
  return createEndpointRouteRouter(
    obstacles,
    sourceElement,
    targetElement,
    routedConnections,
    ignoredFlow
  ).isClear(points);
}

function createEndpointRouteRouter(
    obstacles: ConnectionObstacle[],
    sourceElement: BpmnElement | undefined,
    targetElement: BpmnElement | undefined,
    routedConnections: RoutedConnection[],
    ignoredFlow: BpmnElement | null
) {
  return createOrthogonalRouter({
    obstacles: obstacles.map(({ element, rect }) => ({
      excluded: element === sourceElement || element === targetElement,
      rect
    })),
    routes: routedConnections
      .filter(({ flow }) => flow !== ignoredFlow)
      .map(({ points }) => ({
        allowCollinearOverlap: true,
        points
      }))
  });
}

function flipTangentElbow(
    element: BpmnElement,
    sourceElement: BpmnElement | undefined,
    points: Waypoint[],
    sourceBounds: Rect,
    targetBounds: Rect,
    shapes: Map<BpmnElement, Rect>
): Waypoint[] {
  const [ start, corner, end ] = points;

  if (!is(sourceElement, 'bpmn:BoundaryEvent') ||
      !start ||
      !corner ||
      !end ||
      dockingDirectionMatches(start, corner, sourceBounds) ||
      dockingDirectionMatches(end, corner, targetBounds)) {
    return points;
  }

  const alternate = cleanPoints([
    start,
    point(start.x, end.y),
    end
  ]);

  if (alternate.length !== 3) {
    return points;
  }

  return createBpmnOrthogonalRouter({
    shapes: connectionObstacles(shapes),
    sourceElement,
    targetElement: getConnectionTarget(element)
  }).isClear(alternate) ? alternate : points;
}

function connectionObstacles(
    shapes: Map<BpmnElement, Rect>
): ConnectionObstacle[] {
  return [ ...shapes.entries() ]
    .filter(([ candidate ]) => {
      return !is(candidate, 'bpmn:Lane') &&
        !is(candidate, 'bpmn:Participant') &&
        !isArtifact(candidate);
    })
    .map(([ candidate, rect ]) => ({ element: candidate, rect }));
}

function orientPlaneDockings(layout: LayoutState): void {
  const shapes = new Map([
    ...layout.shapes,
    ...getExpandedChildShapes(layout)
  ]);
  const edges = [
    ...layout.edges,
    ...getExpandedChildEdges(layout)
  ];

  for (const [ element, points ] of edges) {

    if (points.length < 2) {
      continue;
    }

    const source = getConnectionSource(element);
    const sourceBounds = source ? shapes.get(source) : undefined;
    const target = getConnectionTarget(element);
    const targetBounds = target ? shapes.get(target) : undefined;
    const requireOrthogonal = !is(element, 'bpmn:Association') &&
      !is(element, 'bpmn:DataAssociation');

    if (sourceBounds) {
      orientPlaneEdgeDocking(
        points,
        sourceBounds,
        true,
        true,
        point,
        requireOrthogonal,
        requiresCenteredDocking(source)
      );
    }
    if (targetBounds) {
      orientPlaneEdgeDocking(
        points,
        targetBounds,
        false,
        true,
        point,
        requireOrthogonal,
        requiresCenteredDocking(target)
      );
    }
  }
}

function orientPlaneEdgeDocking(
    points: Waypoint[],
    rect: Rect,
    source: boolean,
    allowDogleg = false,
    createPoint: PointFactory = point,
    requireOrthogonal = true,
    centerSides = false
): void {
  while (points.length > 1) {
    const endpointIndex = source ? 0 : points.length - 1;
    const adjacentIndex = source ? 1 : points.length - 2;
    const endpoint = points[endpointIndex];
    const adjacent = points[adjacentIndex];
    let dock = orientDockingPoint(endpoint, adjacent, rect, requireOrthogonal);

    if (centerSides) {
      dock = centerDockingPoint(dock, adjacent, rect);

      if (dock.x !== endpoint.x || dock.y !== endpoint.y) {
        endpoint.x = dock.x;
        endpoint.y = dock.y;

        if (
          allowDogleg &&
          endpoint.x !== adjacent.x &&
          endpoint.y !== adjacent.y
        ) {
          addDockingDogleg(points, endpointIndex, adjacent, rect, source, createPoint);
          return;
        }
      }
    }

    if (
      allowDogleg &&
      requireOrthogonal &&
      moveAmbiguousCornerDocking(endpoint, adjacent, rect)
    ) {
      addDockingDogleg(
        points,
        endpointIndex,
        adjacent,
        rect,
        source,
        createPoint,
        true
      );
      return;
    }

    if (
      allowDogleg &&
      requireOrthogonal &&
      dockingDirectionMatches(endpoint, adjacent, rect, false) &&
      !dockingDirectionMatches(endpoint, adjacent, rect, true)
    ) {
      addDockingDogleg(points, endpointIndex, adjacent, rect, source, createPoint);
      return;
    }

    if (allowDogleg && dock.x === adjacent.x && dock.y === adjacent.y) {
      addDockingDogleg(points, endpointIndex, adjacent, rect, source, createPoint);
      return;
    }

    if (points.length > 2 && pointIsWithin(adjacent, rect)) {
      points.splice(adjacentIndex, 1);
      continue;
    }

    endpoint.x = dock.x;
    endpoint.y = dock.y;

    if (points.length > 2 && endpoint.x === adjacent.x && endpoint.y === adjacent.y) {
      points.splice(adjacentIndex, 1);
      continue;
    }

    return;
  }
}

function requiresCenteredDocking(element: BpmnElement | undefined): boolean {
  return is(element, 'bpmn:Event') || is(element, 'bpmn:Gateway');
}

function centerDockingPoint(dock: Point, adjacent: Point, rect: Rect): Point {
  if (dock.x === adjacent.x) {
    if (dock.y === rect.y) {
      return point(rect.x + rect.width / 2, rect.y);
    }
    if (dock.y === rect.y + rect.height) {
      return point(rect.x + rect.width / 2, rect.y + rect.height);
    }
  }
  if (dock.y === adjacent.y) {
    if (dock.x === rect.x) {
      return point(rect.x, rect.y + rect.height / 2);
    }
    if (dock.x === rect.x + rect.width) {
      return point(rect.x + rect.width, rect.y + rect.height / 2);
    }
  }

  return dock;
}

function addDockingDogleg(
    points: Waypoint[],
    endpointIndex: number,
    adjacent: Point,
    rect: Rect,
    source: boolean,
    createPoint: PointFactory,
    replaceAdjacentBridge = false
): void {
  const endpoint = points[endpointIndex];
  let outward;
  let bridge;

  const onHorizontalSide =
    (endpoint.y === rect.y || endpoint.y === rect.y + rect.height) &&
    endpoint.x > rect.x &&
    endpoint.x < rect.x + rect.width;

  if (onHorizontalSide || (
    adjacent.y === endpoint.y &&
    (endpoint.y === rect.y || endpoint.y === rect.y + rect.height)
  )) {
    const direction = endpoint.y === rect.y ? -1 : 1;
    const y = endpoint.y + direction * ROUTING_MARGIN;

    outward = createPoint(endpoint.x, y);
    bridge = createPoint(adjacent.x, y);
  } else {
    const direction = endpoint.x === rect.x ? -1 : 1;
    const x = endpoint.x + direction * ROUTING_MARGIN;

    outward = createPoint(x, endpoint.y);
    bridge = createPoint(x, adjacent.y);
  }

  const continuationIndex = source ? 2 : endpointIndex - 2;
  const continuation = points[continuationIndex];
  const bridgeContinuesAdjacentSegment = replaceAdjacentBridge && continuation && (
    (
      bridge.x === adjacent.x &&
      continuation.x === adjacent.x
    ) ||
    (
      bridge.y === adjacent.y &&
      continuation.y === adjacent.y
    )
  );
  let dogleg;

  if (bridgeContinuesAdjacentSegment) {
    adjacent.x = bridge.x;
    adjacent.y = bridge.y;
    dogleg = [ outward ];
  } else {
    dogleg = bridge.x === adjacent.x && bridge.y === adjacent.y
      ? [ outward ]
      : [ outward, bridge ];
  }

  if (source) {
    points.splice(1, 0, ...dogleg);
  } else {
    points.splice(endpointIndex, 0, ...dogleg.reverse());
  }
}

function moveAmbiguousCornerDocking(
    endpoint: Point,
    adjacent: Point,
    rect: Rect
): boolean {
  const onVerticalSide =
    endpoint.x === rect.x ||
    endpoint.x === rect.x + rect.width;
  const onHorizontalSide =
    endpoint.y === rect.y ||
    endpoint.y === rect.y + rect.height;

  if (!onVerticalSide || !onHorizontalSide) {
    return false;
  }

  if (endpoint.y === adjacent.y) {
    endpoint.x += endpoint.x === rect.x ? ROUTING_MARGIN : -ROUTING_MARGIN;
    return true;
  }

  if (endpoint.x === adjacent.x) {
    endpoint.y += endpoint.y === rect.y ? ROUTING_MARGIN : -ROUTING_MARGIN;
    return true;
  }

  return false;
}

function pointIsWithin(candidatePoint: Point, rect: Rect): boolean {
  return candidatePoint.x >= rect.x &&
    candidatePoint.x <= rect.x + rect.width &&
    candidatePoint.y >= rect.y &&
    candidatePoint.y <= rect.y + rect.height;
}

function orientDockingPoint(
    endpoint: Point,
    adjacent: Point,
    rect: Rect,
    requireOrthogonal = true
): Point {
  if (dockingDirectionMatches(endpoint, adjacent, rect, requireOrthogonal)) {
    return endpoint;
  }

  if (endpoint.x === adjacent.x) {
    return point(
      endpoint.x,
      adjacent.y < endpoint.y ? rect.y : rect.y + rect.height
    );
  }
  if (endpoint.y === adjacent.y) {
    return point(
      adjacent.x < endpoint.x ? rect.x : rect.x + rect.width,
      endpoint.y
    );
  }
  if (adjacent.x < rect.x) {
    return point(rect.x, Math.max(rect.y, Math.min(adjacent.y, rect.y + rect.height)));
  }
  if (adjacent.x > rect.x + rect.width) {
    return point(
      rect.x + rect.width,
      Math.max(rect.y, Math.min(adjacent.y, rect.y + rect.height))
    );
  }
  if (adjacent.y < rect.y) {
    return point(Math.max(rect.x, Math.min(adjacent.x, rect.x + rect.width)), rect.y);
  }
  if (adjacent.y > rect.y + rect.height) {
    return point(
      Math.max(rect.x, Math.min(adjacent.x, rect.x + rect.width)),
      rect.y + rect.height
    );
  }

  return endpoint;
}

function dockingDirectionMatches(
    endpoint: Point,
    adjacent: Point,
    rect: Rect,
    requireOrthogonal = true
): boolean {
  const vertical = !requireOrthogonal || endpoint.x === adjacent.x;
  const horizontal = !requireOrthogonal || endpoint.y === adjacent.y;

  return (vertical && (
    (endpoint.y === rect.y && adjacent.y < endpoint.y) ||
    (endpoint.y === rect.y + rect.height && adjacent.y > endpoint.y)
  )) || (horizontal && (
    (endpoint.x === rect.x && adjacent.x < endpoint.x) ||
    (endpoint.x === rect.x + rect.width && adjacent.x > endpoint.x)
  ));
}
