import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import {
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
  BpmnFlowNode,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';

export type LayoutScore = {
  vector: number[];
  hardDefects: number[];
  spineLoadImbalance: number;
};

type RoutedEdge = {
  element: FlowEdge;
  points: Waypoint[];
};
type FlowNode = ModdleElement<BpmnFlowNode>;
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
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
      return isScoredEdge(entry[0]);
    })
    .map(([ element, points ]) => ({ element, points }));
  const overlaps = countShapeOverlaps(shapes);
  const edgeShapeIntersections = countEdgeShapeIntersections(edges, shapes);
  const dockingDefects = countDockingDefects(edges, candidate.layout.shapes);
  const routeDefects = countRouteDefects(edges);
  const crossings = countCrossings(edges);
  const spineImbalance = measureSpineLoadImbalance(shapes, policy);
  const extents = getShapeExtents(shapes);
  const footprint = extents.width * extents.height;
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
    routeDefects
  ];

  return {
    hardDefects,
    spineLoadImbalance: spineImbalance,
    vector: [
      ...hardDefects,
      crossings,
      spineImbalance,
      footprint,
      bends,
      length + candidate.displacement,
      candidate.displacement
    ]
  };
}

export function introducesHardDefect(
    candidate: LayoutScore,
    baseline: LayoutScore
): boolean {
  return candidate.hardDefects.some((value, index) => {
    return value > baseline.hardDefects[index];
  });
}

function collectScoredShapes(layout: LayoutState): Shape[] {
  const shapes: Shape[] = [];

  for (const [ element, rect ] of layout.shapes) {
    if (!isContainer(element) && !isArtifact(element)) {
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
      !pointTouchesRect(last, target)
    ) {
      defects++;
      continue;
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
    if (isScoredEdge(edge)) {
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

function isScoredEdge(element: BpmnElement): element is FlowEdge {
  return is(element, 'bpmn:SequenceFlow') &&
    !!element.sourceRef &&
    !!element.targetRef;
}
