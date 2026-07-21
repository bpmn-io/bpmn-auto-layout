import { is } from './DiUtil.js';
import { ROUTING_MARGIN } from '../layout/Constants.js';
import { isArtifact } from '../layout/BpmnUtil.js';
import { point, integerBounds, cleanPoints, toSegments, segmentsProperlyCross, getExpandedChildShapes } from '../layout/LayoutUtil.js';
import { visibilityRoute, pathIsClear } from '../layout/SequenceFlowRouter.js';

export function emitLayout(factory, layout, planeElements) {
  for (const [ element, rect ] of layout.shapes) {
    const attrs = {};

    if (is(element, 'bpmn:SubProcess') && layout.children.some(child => child.scope === element && child.emitInParent)) {
      attrs.isExpanded = true;
    }

    if (is(element, 'bpmn:Participant') || is(element, 'bpmn:Lane')) {
      attrs.isHorizontal = true;
    }

    if (is(element, 'bpmn:Gateway')) {
      attrs.isMarkerVisible = true;
    }

    planeElements.push(factory.createDiShape(element, integerBounds(rect), {
      id: `BPMNShape_${element.id}`,
      ...attrs
    }));
  }

  const emittedShapes = new Map([
    ...layout.shapes,
    ...getExpandedChildShapes(layout)
  ]);

  for (const [ element, points ] of layout.edges) {
    const routedConnections = [ ...layout.edges ]
      .filter(([ candidate ]) => candidate !== element)
      .map(([ flow, candidatePoints ]) => ({ flow, points: candidatePoints }));

    planeElements.push(factory.createDiEdge(element, orientDockingPoints(
      element,
      cleanPoints(points),
      emittedShapes,
      routedConnections
    ), {
      id: `BPMNEdge_${element.id}`
    }));
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      emitLayout(factory, child, planeElements);
    }
  }
}

function orientDockingPoints(element, points, shapes, routedConnections) {
  const source = Array.isArray(element.sourceRef) ? element.sourceRef[0] : element.sourceRef;
  const sourceBounds = shapes.get(source);
  const targetBounds = shapes.get(element.targetRef);
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
    element,
    sourceElement,
    points,
    sourceBounds,
    targetBounds,
    shapes,
    routedConnections) {
  if (!is(sourceElement, 'bpmn:BoundaryEvent') || points.length < 2) {
    return points;
  }

  const host = shapes.get(sourceElement.attachedToRef);
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
  const targetStub = outwardDockingStub(targetDock, targetBounds);
  const obstacles = connectionObstacles(shapes);
  const route = visibilityRoute(
    stub,
    targetStub,
    obstacles,
    sourceElement,
    element.targetRef,
    routedConnections
  ) || visibilityRoute(
    stub,
    targetStub,
    obstacles,
    sourceElement,
    element.targetRef,
    []
  );

  return route ? cleanPoints([ sourceDock, ...route, targetDock ]) : points;
}

function outwardDockingStub(dock, rect) {
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

function facingDock(source, rect) {
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
    element,
    sourceElement,
    points,
    sourceBounds,
    targetBounds,
    shapes,
    routedConnections) {
  if (!is(element, 'bpmn:SequenceFlow') || points.length !== 3) {
    return points;
  }

  const [ start, elbow, end ] = points;
  const sourceVertical = start.x === elbow.x && start.y !== elbow.y;
  const sourceHorizontal = start.y === elbow.y && start.x !== elbow.x;
  const targetVertical = end.x === elbow.x && end.y !== elbow.y;
  const targetHorizontal = end.y === elbow.y && end.x !== elbow.x;

  if (!(
    (sourceVertical && targetHorizontal) ||
    (sourceHorizontal && targetVertical)
  )) {
    return points;
  }

  const sourceDock = sourceVertical
    ? point(
      sourceBounds.x + sourceBounds.width / 2,
      elbow.y < start.y ? sourceBounds.y : sourceBounds.y + sourceBounds.height
    )
    : point(
      elbow.x < start.x ? sourceBounds.x : sourceBounds.x + sourceBounds.width,
      sourceBounds.y + sourceBounds.height / 2
    );
  const targetDock = targetVertical
    ? point(
      targetBounds.x + targetBounds.width / 2,
      elbow.y < end.y ? targetBounds.y : targetBounds.y + targetBounds.height
    )
    : point(
      elbow.x < end.x ? targetBounds.x : targetBounds.x + targetBounds.width,
      targetBounds.y + targetBounds.height / 2
    );
  const centered = sourceVertical
    ? [ sourceDock, point(sourceDock.x, targetDock.y), targetDock ]
    : [ sourceDock, point(targetDock.x, sourceDock.y), targetDock ];
  const obstacles = connectionObstacles(shapes);

  if (endpointRouteIsClear(
    centered,
    obstacles,
    sourceElement,
    element.targetRef,
    routedConnections
  )) {
    return centered;
  }

  const sourceCenterX = sourceBounds.x + sourceBounds.width / 2;
  const sourceCenterY = sourceBounds.y + sourceBounds.height / 2;
  const targetCenterX = targetBounds.x + targetBounds.width / 2;
  const targetCenterY = targetBounds.y + targetBounds.height / 2;
  const transposedSourceDock = sourceVertical
    ? point(
      targetCenterX < sourceCenterX ? sourceBounds.x : sourceBounds.x + sourceBounds.width,
      sourceCenterY
    )
    : point(
      sourceCenterX,
      targetCenterY < sourceCenterY ? sourceBounds.y : sourceBounds.y + sourceBounds.height
    );
  const transposedTargetDock = sourceVertical
    ? point(
      targetCenterX,
      sourceCenterY < targetCenterY ? targetBounds.y : targetBounds.y + targetBounds.height
    )
    : point(
      sourceCenterX < targetCenterX ? targetBounds.x : targetBounds.x + targetBounds.width,
      targetCenterY
    );
  const transposed = sourceVertical
    ? [
      transposedSourceDock,
      point(transposedTargetDock.x, transposedSourceDock.y),
      transposedTargetDock
    ]
    : [
      transposedSourceDock,
      point(transposedSourceDock.x, transposedTargetDock.y),
      transposedTargetDock
    ];
  const alternateTargetDock = sourceVertical
    ? point(
      targetCenterX,
      sourceCenterY < targetCenterY ? targetBounds.y : targetBounds.y + targetBounds.height
    )
    : point(
      sourceCenterX < targetCenterX ? targetBounds.x : targetBounds.x + targetBounds.width,
      targetCenterY
    );
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

  if (endpointRouteIsClear(
    bypass,
    obstacles,
    sourceElement,
    element.targetRef,
    routedConnections
  )) {
    return bypass;
  }

  if (endpointRouteIsClear(
    transposed,
    obstacles,
    sourceElement,
    element.targetRef,
    routedConnections
  )) {
    return transposed;
  }

  const facingSourceDock = facingDock(point(targetCenterX, targetCenterY), sourceBounds);
  const facingTargetDock = facingDock(point(sourceCenterX, sourceCenterY), targetBounds);
  const sourceStub = outwardDockingStub(facingSourceDock, sourceBounds);
  const targetStub = outwardDockingStub(facingTargetDock, targetBounds);

  if (endpointRouteIsClear(
    centered,
    obstacles,
    sourceElement,
    element.targetRef,
    []
  )) {
    return centered;
  }

  if (endpointRouteIsClear(
    bypass,
    obstacles,
    sourceElement,
    element.targetRef,
    []
  )) {
    return bypass;
  }

  if (endpointRouteIsClear(
    transposed,
    obstacles,
    sourceElement,
    element.targetRef,
    []
  )) {
    return transposed;
  }

  const visibilityRouteWithCrossings = visibilityRoute(
    sourceStub,
    targetStub,
    obstacles,
    sourceElement,
    element.targetRef,
    []
  );

  return visibilityRouteWithCrossings
    ? cleanPoints([
      facingSourceDock,
      ...visibilityRouteWithCrossings,
      facingTargetDock
    ])
    : points;
}

function endpointRouteIsClear(
    points,
    obstacles,
    sourceElement,
    targetElement,
    routedConnections) {
  if (!pathIsClear(points, obstacles, sourceElement, targetElement, [])) {
    return false;
  }

  return !toSegments(points).some(([ a, b ]) => {
    return routedConnections.some(connection => {
      return toSegments(connection.points).some(([ c, d ]) => {
        return segmentsProperlyCross(a, b, c, d);
      });
    });
  });
}

function flipTangentElbow(element, sourceElement, points, sourceBounds, targetBounds, shapes) {
  if (!is(sourceElement, 'bpmn:BoundaryEvent') ||
      points.length !== 3 ||
      dockingDirectionMatches(points[0], points[1], sourceBounds) ||
      dockingDirectionMatches(points.at(-1), points.at(-2), targetBounds)) {
    return points;
  }

  const alternate = cleanPoints([
    points[0],
    point(points[0].x, points.at(-1).y),
    points.at(-1)
  ]);

  if (alternate.length !== 3) {
    return points;
  }

  return pathIsClear(
    alternate,
    connectionObstacles(shapes),
    sourceElement,
    element.targetRef,
    []
  ) ? alternate : points;
}

function connectionObstacles(shapes) {
  return [ ...shapes.entries() ]
    .filter(([ candidate ]) => {
      return !is(candidate, 'bpmn:Lane') &&
        !is(candidate, 'bpmn:Participant') &&
        !isArtifact(candidate);
    })
    .map(([ candidate, rect ]) => ({ element: candidate, rect }));
}

export function orientPlaneDockings(factory, planeElements) {
  const shapes = new Map(
    planeElements
      .filter(di => di.$instanceOf('bpmndi:BPMNShape'))
      .map(di => [ di.bpmnElement.id, di.bounds ])
  );

  for (const di of planeElements.filter(di => di.$instanceOf('bpmndi:BPMNEdge'))) {
    const points = di.waypoint;

    if (points.length < 2) {
      continue;
    }

    const element = di.bpmnElement;
    const source = Array.isArray(element.sourceRef) ? element.sourceRef[0] : element.sourceRef;
    const sourceBounds = shapes.get(source?.id);
    const targetBounds = shapes.get(element.targetRef?.id);

    if (sourceBounds) {
      orientPlaneEdgeDocking(
        points,
        sourceBounds,
        true,
        true,
        (x, y) => factory.createDiWaypoint({ x, y })
      );
    }
    if (targetBounds) {
      orientPlaneEdgeDocking(
        points,
        targetBounds,
        false,
        true,
        (x, y) => factory.createDiWaypoint({ x, y })
      );
    }
  }
}

function orientPlaneEdgeDocking(
    points,
    rect,
    source,
    allowDogleg = false,
    createPoint = point) {
  while (points.length > 1) {
    const endpointIndex = source ? 0 : points.length - 1;
    const adjacentIndex = source ? 1 : points.length - 2;
    const endpoint = points[endpointIndex];
    const adjacent = points[adjacentIndex];
    const dock = orientDockingPoint(endpoint, adjacent, rect);

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

function addDockingDogleg(points, endpointIndex, adjacent, rect, source, createPoint) {
  const endpoint = points[endpointIndex];
  let outward;
  let bridge;

  if (
    adjacent.y === endpoint.y &&
    (endpoint.y === rect.y || endpoint.y === rect.y + rect.height)
  ) {
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

  if (source) {
    points.splice(1, 0, outward, bridge);
  } else {
    points.splice(endpointIndex, 0, bridge, outward);
  }
}

function pointIsWithin(candidatePoint, rect) {
  return candidatePoint.x >= rect.x &&
    candidatePoint.x <= rect.x + rect.width &&
    candidatePoint.y >= rect.y &&
    candidatePoint.y <= rect.y + rect.height;
}

function orientDockingPoint(endpoint, adjacent, rect) {
  if (dockingDirectionMatches(endpoint, adjacent, rect)) {
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

function dockingDirectionMatches(endpoint, adjacent, rect) {
  return (endpoint.y === rect.y && adjacent.y < endpoint.y) ||
    (endpoint.y === rect.y + rect.height && adjacent.y > endpoint.y) ||
    (endpoint.x === rect.x && adjacent.x < endpoint.x) ||
    (endpoint.x === rect.x + rect.width && adjacent.x > endpoint.x);
}
