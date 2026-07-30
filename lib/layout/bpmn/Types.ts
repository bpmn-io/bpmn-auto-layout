import type { ModdleElement } from 'moddle';

import type {
  BpmnBaseElement,
  BpmnModdleTypeMap
} from '../../moddle-types/bpmn.js';
import type { BpmndiModdleTypeMap } from '../../moddle-types/bpmndi.js';
import type { DcModdleTypeMap } from '../../moddle-types/dc.js';

export type BpmnElement = ModdleElement<BpmnBaseElement>;

export type BpmnTypeName = keyof BpmnModdleTypeMap;

export type BpmnElementFor<Type extends BpmnTypeName> = BpmnModdleTypeMap[Type];

export type BpmndiTypeName = keyof BpmndiModdleTypeMap;

export type BpmndiElementFor<Type extends BpmndiTypeName> =
  BpmndiModdleTypeMap[Type];

export type BpmnDiModdleTypeMap = BpmnModdleTypeMap &
  BpmndiModdleTypeMap &
  DcModdleTypeMap;

export type BpmnDiModdleTypeName = keyof BpmnDiModdleTypeMap;

export type BpmnDiModdleElementFor<Type extends BpmnDiModdleTypeName> =
  BpmnDiModdleTypeMap[Type];

export type BpmnDiModdleElementAttributes<
  Type extends BpmnDiModdleTypeName
> = Omit<BpmnDiModdleElementFor<Type>, '$instanceOf' | '$parent' | '$type'>;

export type BpmnDiModdleFactory = {
  create<Type extends BpmnDiModdleTypeName>(
    type: Type,
    attributes?: BpmnDiModdleElementAttributes<Type>
  ): BpmnDiModdleElementFor<Type>;
};

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

export function isBpmndiType<Type extends BpmndiTypeName>(
    element: unknown,
    type: Type
): element is BpmndiElementFor<Type> {
  return isBpmnElement(element) && element.$instanceOf(type);
}
