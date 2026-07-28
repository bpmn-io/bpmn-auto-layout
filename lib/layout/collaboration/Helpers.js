import { getExpandedChildShapes } from '../geometry/index.js';

export function collectCollaborationShapes(layout) {
  return new Map([
    ...layout.shapes,
    ...getExpandedChildShapes(layout)
  ]);
}

export function includeHorizontalRange(bounds, min, max) {
  const right = bounds.x + bounds.width;

  bounds.x = Math.min(bounds.x, min);
  bounds.width = Math.max(right, max) - bounds.x;
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
