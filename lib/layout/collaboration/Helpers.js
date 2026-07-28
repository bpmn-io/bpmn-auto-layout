import { getExpandedChildShapes } from '../geometry/index.js';

export function collectCollaborationShapes(layout) {
  return new Map([
    ...layout.shapes,
    ...getExpandedChildShapes(layout)
  ]);
}

export function collectMessageFlowEndpointDirections(messageFlows) {
  const directions = new Map();
  const addDirection = (element, direction) => {
    if (!directions.has(element)) {
      directions.set(element, new Set());
    }

    directions.get(element).add(direction);
  };

  for (const messageFlow of messageFlows) {
    addDirection(messageFlow.sourceRef, 'outgoing');
    addDirection(messageFlow.targetRef, 'incoming');
  }

  return directions;
}
