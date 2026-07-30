import { getExpandedChildShapes } from '../geometry/index.js';
import { isBpmnElement } from '../bpmn/Types.js';

import type { ModdleElement } from 'moddle';
import type { BpmnMessageFlow } from '../../moddle-types/bpmn.js';

import type {
  BpmnElement,
  Bounds,
  LayoutState
} from '../Types.js';

type MessageFlowEndpointDirection = 'incoming' | 'outgoing';
type MessageFlow = ModdleElement<BpmnMessageFlow>;

export function collectCollaborationShapes(
    layout: LayoutState
): Map<BpmnElement, Bounds> {
  return new Map([
    ...layout.shapes,
    ...getExpandedChildShapes(layout)
  ]);
}

export function includeHorizontalRange(
    bounds: Bounds,
    min: number,
    max: number
): void {
  const right = bounds.x + bounds.width;

  bounds.x = Math.min(bounds.x, min);
  bounds.width = Math.max(right, max) - bounds.x;
}

export function collectMessageFlowEndpointDirections(
    messageFlows: MessageFlow[]
): Map<BpmnElement, Set<string>> {
  const directions = new Map<BpmnElement, Set<string>>();
  const addDirection = (
      element: BpmnElement,
      direction: MessageFlowEndpointDirection
  ) => {
    if (!directions.has(element)) {
      directions.set(element, new Set<string>());
    }

    directions.get(element)?.add(direction);
  };

  for (const messageFlow of messageFlows) {
    if (isBpmnElement(messageFlow.sourceRef)) {
      addDirection(messageFlow.sourceRef, 'outgoing');
    }

    if (isBpmnElement(messageFlow.targetRef)) {
      addDirection(messageFlow.targetRef, 'incoming');
    }
  }

  return directions;
}
