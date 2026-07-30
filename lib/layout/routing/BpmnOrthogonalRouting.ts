import { createOrthogonalRouter } from './OrthogonalRouting.js';

import type { Point, Rect } from 'diagram-js/lib/util/Types.js';

import type { BpmnElement } from '../Types.js';

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
  obstacleInset?: number;
  allowPerpendicularCrossings?: boolean;
  maxVisibilityPoints?: number;
};

export function createBpmnOrthogonalRouter({
  shapes = [],
  sourceElement,
  targetElement,
  routedConnections = [],
  obstacleInset,
  allowPerpendicularCrossings,
  maxVisibilityPoints
}: BpmnOrthogonalRouterOptions = {}): ReturnType<typeof createOrthogonalRouter> {
  return createOrthogonalRouter({
    obstacles: shapes.map(({ element, rect }) => ({
      excluded: element === sourceElement || element === targetElement,
      rect
    })),
    routes: routedConnections.map(({ flow, points }) => ({
      allowCollinearOverlap: sharesEndpointChannel(
        flow,
        sourceElement,
        targetElement
      ),
      points
    })),
    obstacleInset,
    allowPerpendicularCrossings,
    maxVisibilityPoints
  });
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
