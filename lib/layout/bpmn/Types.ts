import type { ModdleElement } from 'moddle';

import type {
  BpmnBaseElement,
  BpmnModdleTypeMap
} from '../../moddle-types/bpmn.js';

export type BpmnElement = ModdleElement<BpmnBaseElement>;

export type BpmnTypeName = keyof BpmnModdleTypeMap;

export type BpmnElementFor<Type extends BpmnTypeName> = BpmnModdleTypeMap[Type];

export function isBpmnElement(element: unknown): element is BpmnElement {
  return !!element &&
    typeof element === 'object' &&
    '$instanceOf' in element &&
    typeof element.$instanceOf === 'function';
}

export function isBpmnType<Type extends BpmnTypeName>(
    element: unknown,
    type: Type
): element is BpmnElementFor<Type> {
  return isBpmnElement(element) && element.$instanceOf(type);
}
