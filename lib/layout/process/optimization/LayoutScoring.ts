import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import {
  collinearOverlap,
  getShapeExtents,
  inset,
  rectanglesOverlap,
  routeLength,
  segmentEntersRect,
  segmentsProperlyCross,
  toSegments
} from '../../geometry/index.js';

import type {
  BpmnElement,
  Bounds,
  LayoutState,
  SemanticPolicy,
  Waypoint
} from '../../Types.js';
import type { PlacementCandidate } from './PlacementCandidate.js';
import type { ModdleElement } from 'moddle';
import type {
  BpmnAssociation,
  BpmnFlowNode,
  BpmnMessageFlow,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';

export type LayoutScore = {
  bends: number;
  vector: number[];
  hardDefects: number[];
  length: number;
  footprint: number;
  spineLoadImbalance: number;
  containerFootprint: number;
};

export type CompleteLayoutScore = {
  bends: number;
  containerFootprint: number;
  crossings: number;
  footprint: number;
  hardDefects: number[];
  length: number;
  vector: number[];
};

type RoutedEdge = {
  element: ConnectionEdge;
  points: Waypoint[];
};
type FlowNode = ModdleElement<BpmnFlowNode>;
type FlowEdge =
  & ModdleElement<BpmnSequenceFlow | BpmnMessageFlow>
  & {
    sourceRef: FlowNode;
    targetRef: FlowNode;
  };
type ConnectionEdge =
  & ModdleElement<BpmnSequenceFlow | BpmnMessageFlow | BpmnAssociation>
  & {
    sourceRef: BpmnElement;
    targetRef: BpmnElement;
  };

type Shape = {
  element: BpmnElement;
  rect: Bounds;
};

export function scorePlacementCandidate(
    candidate: PlacementCandidate,
    policy: SemanticPolicy
): LayoutScore {
  const shapes = collectScoredShapes(candidate.layout);
  const edges = [ ...candidate.layout.edges ]
    .filter((entry): entry is [ FlowEdge, Waypoint[] ] => {
      return isFlowEdge(entry[0]);
    })
    .map(([ element, points ]) => ({ element, points }));
  const overlaps = countShapeOverlaps(shapes);
  const edgeShapeIntersections = countEdgeShapeIntersections(edges, shapes);
  const dockingDefects = countDockingDefects(edges, candidate.layout.shapes);
  const routeDefects = countRouteDefects(edges);
  const opposingEdgeOverlaps = countOpposingEdgeOverlaps(edges);
  const feedbackApproachDefects = countFeedbackApproachDefects(
    edges,
    candidate.layout.shapes,
    policy
  );
  const crossings = countCrossings(edges);
  const spineImbalance = measureSpineLoadImbalance(shapes, policy);
  const extents = getShapeExtents(shapes);
  const footprint = extents.width * extents.height;
  const containerFootprint = measureContainerFootprint(candidate.layout);
  const bends = edges.reduce((total, edge) => {
    return total + Math.max(0, edge.points.length - 2);
  }, 0);
  const length = edges.reduce((total, edge) => {
    return total + routeLength(edge.points);
  }, 0);
  const hardDefects = [
    overlaps,
    edgeShapeIntersections,
    dockingDefects,
    routeDefects,
    opposingEdgeOverlaps
  ];

  return {
    bends,
    hardDefects,
    length,
    footprint,
    spineLoadImbalance: spineImbalance,
    containerFootprint,
    vector: [
      ...hardDefects,
      feedbackApproachDefects,
      crossings,
      spineImbalance,
      containerFootprint,
      footprint,
      bends,
      length + candidate.displacement,
      candidate.displacement
    ]
  };
}

export function scoreCompleteLayout(layout: LayoutState): CompleteLayoutScore {
  const shapes = collectScoredShapes(layout);
  const edges = collectScoredEdges(layout);
  const flowEdges = edges.filter((edge): edge is RoutedEdge & {
    element: FlowEdge;
  } => {
    return isFlowEdge(edge.element);
  });
  const overlaps = countShapeOverlaps(shapes);
  const edgeShapeIntersections = countEdgeShapeIntersections(edges, shapes);
  const routeDefects = countRouteDefects(flowEdges);
  const opposingEdgeOverlaps = countOpposingEdgeOverlaps(edges, true);
  const crossings = countCrossings(edges);
  const extents = getShapeExtents(shapes);
  const footprint = extents.width * extents.height;
  const containerFootprint = measureContainerFootprint(layout);
  const bends = edges.reduce((total, edge) => {
    return total + Math.max(0, edge.points.length - 2);
  }, 0);
  const length = edges.reduce((total, edge) => {
    return total + routeLength(edge.points);
  }, 0);
  const hardDefects = [
    overlaps,
    edgeShapeIntersections,
    routeDefects,
    opposingEdgeOverlaps
  ];

  return {
    bends,
    containerFootprint,
    crossings,
    footprint,
    hardDefects,
    length,
    vector: [
      ...hardDefects,
      crossings,
      containerFootprint,
      footprint,
      bends,
      length
    ]
  };
}

function collectScoredEdges(layout: LayoutState): RoutedEdge[] {
  const edges = [ ...layout.edges ]
    .filter((entry): entry is [ FlowEdge, Waypoint[] ] => {
      return isCompleteEdge(entry[0]);
    })
    .map(([ element, points ]) => ({ element, points }));

  for (const child of layout.children) {
    if (child.emitInParent) {
      edges.push(...collectScoredEdges(child));
    }
  }

  return edges;
}

function measureContainerFootprint(layout: LayoutState): number {
  let footprint = 0;

  for (const [ element, rect ] of layout.shapes) {
    if (isContainer(element)) {
      footprint += rect.width * rect.height;
    }
  }

  for (const child of layout.children) {
    footprint += measureContainerFootprint(child);
  }

  return footprint;
}

function countOpposingEdgeOverlaps(
    edges: RoutedEdge[],
    ignoreSharedDockingStubs = false
): number {
  let overlaps = 0;

  for (let left = 0; left < edges.length; left++) {
    for (let right = left + 1; right < edges.length; right++) {
      for (const [ a, b ] of toSegments(edges[left].points)) {
        for (const [ c, d ] of toSegments(edges[right].points)) {
          const opposing =
            (b.x - a.x) * (d.x - c.x) +
            (b.y - a.y) * (d.y - c.y) < 0;

          if (
            opposing &&
            collinearOverlap(a, b, c, d) &&
            (
              !ignoreSharedDockingStubs ||
              !isSharedDockingStub(edges[left], a, b, edges[right], c, d)
            )
          ) {
            overlaps++;
          }
        }
      }
    }
  }

  return overlaps;
}

function isSharedDockingStub(
    leftEdge: RoutedEdge,
    leftStart: Waypoint,
    leftEnd: Waypoint,
    rightEdge: RoutedEdge,
    rightStart: Waypoint,
    rightEnd: Waypoint
): boolean {
  return sharedDockingPoints(leftEdge, rightEdge).some(point => {
    return hasEndpoint(leftStart, leftEnd, point) &&
      hasEndpoint(rightStart, rightEnd, point);
  });
}

function sharedDockingPoints(
    left: RoutedEdge,
    right: RoutedEdge
): Waypoint[] {
  const points: Waypoint[] = [];

  addSharedDockingPoint(
    points,
    left.element.sourceRef,
    left.points[0],
    right.element.sourceRef,
    right.points[0]
  );
  addSharedDockingPoint(
    points,
    left.element.sourceRef,
    left.points[0],
    right.element.targetRef,
    right.points.at(-1)
  );
  addSharedDockingPoint(
    points,
    left.element.targetRef,
    left.points.at(-1),
    right.element.sourceRef,
    right.points[0]
  );
  addSharedDockingPoint(
    points,
    left.element.targetRef,
    left.points.at(-1),
    right.element.targetRef,
    right.points.at(-1)
  );

  return points;
}

function addSharedDockingPoint(
    points: Waypoint[],
    leftElement: BpmnElement,
    leftPoint: Waypoint | undefined,
    rightElement: BpmnElement,
    rightPoint: Waypoint | undefined
): void {
  if (
    leftElement === rightElement &&
    leftPoint &&
    rightPoint &&
    leftPoint.x === rightPoint.x &&
    leftPoint.y === rightPoint.y
  ) {
    points.push(leftPoint);
  }
}

function hasEndpoint(
    start: Waypoint,
    end: Waypoint,
    point: Waypoint
): boolean {
  return samePoint(start, point) || samePoint(end, point);
}

function samePoint(a: Waypoint, b: Waypoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function countFeedbackApproachDefects(
    edges: RoutedEdge[],
    shapes: Map<BpmnElement, Bounds>,
    policy: SemanticPolicy
): number {
  let defects = 0;

  for (const edge of edges) {
    if (!policy.backEdges.has(edge.element)) {
      continue;
    }

    const source = shapes.get(edge.element.sourceRef);
    const target = shapes.get(edge.element.targetRef);
    const end = edge.points.at(-1);

    if (!source || !target || !end) {
      continue;
    }

    const sourceCenterY = source.y + source.height / 2;
    const targetCenterY = target.y + target.height / 2;

    if (
      sourceCenterY < targetCenterY && end.y !== target.y ||
      sourceCenterY > targetCenterY && end.y !== target.y + target.height
    ) {
      defects++;
    }
  }

  return defects;
}

export function introducesHardDefect(
    candidate: LayoutScore,
    baseline: LayoutScore
): boolean {
  return candidate.hardDefects.some((value, index) => {
    return value > baseline.hardDefects[index];
  });
}

export function countLayoutShapeOverlaps(layout: LayoutState): number {
  return countShapeOverlaps(collectScoredShapes(layout));
}

function collectScoredShapes(layout: LayoutState): Shape[] {
  const shapes: Shape[] = [];

  for (const [ element, rect ] of layout.shapes) {
    if (
      !isContainer(element) &&
      !isArtifact(element) &&
      !isExpandedContainer(layout, element)
    ) {
      shapes.push({ element, rect });
    }
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      shapes.push(...collectScoredShapes(child));
    }
  }

  return shapes;
}

function isExpandedContainer(
    layout: LayoutState,
    element: BpmnElement
): boolean {
  return layout.children.some(child => {
    return child.emitInParent && child.scope === element;
  });
}

function countShapeOverlaps(shapes: Shape[]): number {
  let overlaps = 0;

  for (let left = 0; left < shapes.length; left++) {
    for (let right = left + 1; right < shapes.length; right++) {
      const a = shapes[left];
      const b = shapes[right];

      if (isBoundaryAttachment(a.element, b.element)) {
        continue;
      }

      if (rectanglesOverlap(a.rect, b.rect)) {
        overlaps++;
      }
    }
  }

  return overlaps;
}

function countEdgeShapeIntersections(
    edges: RoutedEdge[],
    shapes: Shape[]
): number {
  let intersections = 0;

  for (const edge of edges) {
    for (const shape of shapes) {
      if (
        edge.element.sourceRef === shape.element ||
        edge.element.targetRef === shape.element
      ) {
        continue;
      }

      if (toSegments(edge.points).some(([ start, end ]) => {
        return segmentEntersRect(start, end, inset(shape.rect, 1));
      })) {
        intersections++;
      }
    }
  }

  return intersections;
}

function countDockingDefects(
    edges: RoutedEdge[],
    shapes: Map<BpmnElement, Bounds>
): number {
  let defects = 0;

  for (const edge of edges) {
    if (edge.points.length < 2) {
      defects++;
      continue;
    }

    const source = shapes.get(edge.element.sourceRef);
    const target = shapes.get(edge.element.targetRef);

    if (!source || !target) {
      continue;
    }

    const first = edge.points[0];
    const second = edge.points[1];
    const last = edge.points.at(-1);
    const beforeLast = edge.points.at(-2);

    if (
      !last ||
      !beforeLast ||
      !pointTouchesRect(first, source) ||
      !pointTouchesRect(last, target) ||
      !dockingPointsOutward(first, second, source) ||
      !dockingPointsOutward(last, beforeLast, target)
    ) {
      defects++;
      continue;
    }

    function dockingPointsOutward(
        endpoint: Waypoint,
        adjacent: Waypoint,
        rect: Bounds
    ): boolean {
      const sides = [
        endpoint.y === rect.y ? 'top' : null,
        endpoint.y === rect.y + rect.height ? 'bottom' : null,
        endpoint.x === rect.x ? 'left' : null,
        endpoint.x === rect.x + rect.width ? 'right' : null
      ].filter((side): side is 'top' | 'bottom' | 'left' | 'right' => !!side);

      if (sides.length !== 1) {
        return false;
      }

      if (sides[0] === 'top') {
        return adjacent.y < endpoint.y;
      }

      if (sides[0] === 'bottom') {
        return adjacent.y > endpoint.y;
      }

      if (sides[0] === 'left') {
        return adjacent.x < endpoint.x;
      }

      return adjacent.x > endpoint.x;
    }

    if (
      segmentEntersRect(first, second, inset(source, 1)) ||
      segmentEntersRect(beforeLast, last, inset(target, 1))
    ) {
      defects++;
    }
  }

  return defects;
}

function countRouteDefects(edges: RoutedEdge[]): number {
  let defects = 0;

  for (const { points } of edges) {
    const segments = toSegments(points);

    if (segments.some(([ start, end ]) => {
      return start.x !== end.x && start.y !== end.y;
    })) {
      defects++;
      continue;
    }

    if (segments.slice(1).some(([ start, end ], index) => {
      const [ previousStart, previousEnd ] = segments[index];
      const dxA = previousEnd.x - previousStart.x;
      const dyA = previousEnd.y - previousStart.y;
      const dxB = end.x - start.x;
      const dyB = end.y - start.y;

      return dxA * dxB + dyA * dyB < 0 &&
        (dxA === 0) === (dxB === 0);
    })) {
      defects++;
    }
  }

  return defects;
}

function countCrossings(edges: RoutedEdge[]): number {
  let crossings = 0;

  for (let left = 0; left < edges.length; left++) {
    for (let right = left + 1; right < edges.length; right++) {
      for (const [ a, b ] of toSegments(edges[left].points)) {
        for (const [ c, d ] of toSegments(edges[right].points)) {
          if (segmentsProperlyCross(a, b, c, d)) {
            crossings++;
          }
        }
      }
    }
  }

  return crossings;
}

function measureSpineLoadImbalance(
    shapes: Shape[],
    policy: SemanticPolicy
): number {
  const spineNodes = new Set<BpmnElement>();

  for (const edge of policy.spine) {
    if (isFlowEdge(edge)) {
      spineNodes.add(edge.sourceRef);
      spineNodes.add(edge.targetRef);
    }
  }

  const spineCenters = shapes
    .filter(({ element }) => spineNodes.has(element))
    .map(({ rect }) => rect.y + rect.height / 2)
    .sort((a, b) => a - b);

  if (!spineCenters.length || !shapes.length) {
    return 0;
  }

  const spineCenter = spineCenters[Math.floor(spineCenters.length / 2)];
  let above = 0;
  let below = 0;

  for (const { element, rect } of shapes) {
    if (spineNodes.has(element) || is(element, 'bpmn:BoundaryEvent')) {
      continue;
    }

    const center = rect.y + rect.height / 2;

    if (center < spineCenter) {
      above++;
    } else if (center > spineCenter) {
      below++;
    }
  }

  return Math.abs(above - below);
}

function pointTouchesRect(point: Waypoint, rect: Bounds): boolean {
  const onVertical = (point.x === rect.x || point.x === rect.x + rect.width) &&
    point.y >= rect.y && point.y <= rect.y + rect.height;
  const onHorizontal = (point.y === rect.y || point.y === rect.y + rect.height) &&
    point.x >= rect.x && point.x <= rect.x + rect.width;

  return onVertical || onHorizontal;
}

function isContainer(element: BpmnElement): boolean {
  return is(element, 'bpmn:Lane') || is(element, 'bpmn:Participant');
}

function isBoundaryAttachment(a: BpmnElement, b: BpmnElement): boolean {
  return is(a, 'bpmn:BoundaryEvent') && a.attachedToRef === b ||
    is(b, 'bpmn:BoundaryEvent') && b.attachedToRef === a;
}

function isFlowEdge(element: BpmnElement): element is FlowEdge {
  return (
    is(element, 'bpmn:SequenceFlow') ||
    is(element, 'bpmn:MessageFlow')
  ) &&
    !!element.sourceRef &&
    !!element.targetRef;
}

function isCompleteEdge(element: BpmnElement): element is ConnectionEdge {
  return (
    isFlowEdge(element) ||
    is(element, 'bpmn:Association')
  ) &&
    !!element.sourceRef &&
    !!element.targetRef;
}
