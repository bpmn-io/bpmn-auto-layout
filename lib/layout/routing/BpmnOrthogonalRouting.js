import { createOrthogonalRouter } from './OrthogonalRouting.js';

export function createBpmnOrthogonalRouter({
  shapes = [],
  sourceElement,
  targetElement,
  routedConnections = [],
  obstacleInset,
  allowPerpendicularCrossings,
  maxVisibilityPoints
} = {}) {
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

function sharesEndpointChannel(flow, source, target) {
  return flow.sourceRef === source ||
    flow.targetRef === target ||
    (flow.$instanceOf('bpmn:MessageFlow') && (
      (flow.sourceRef === target && flow.targetRef !== source) ||
      (flow.targetRef === source && flow.sourceRef !== target)
    ));
}
