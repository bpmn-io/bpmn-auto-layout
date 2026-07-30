import {
  isBpmnType,
  type BpmnElementFor,
  type BpmnTypeName
} from '../layout/bpmn/Types.js';

export const DEFAULT_TASK_HEIGHT = 80;
export const DEFAULT_TASK_WIDTH = 100;

export type ElementSize = {
  width: number;
  height: number;
};

export function getDefaultSize(element: unknown): ElementSize | null {
  if (is(element, 'bpmn:Activity')) {
    return { width: DEFAULT_TASK_WIDTH, height: DEFAULT_TASK_HEIGHT };
  }

  if (is(element, 'bpmn:Gateway')) {
    return { width: 50, height: 50 };
  }

  if (is(element, 'bpmn:Event')) {
    return { width: 36, height: 36 };
  }

  if (is(element, 'bpmn:Participant')) {
    return { width: 300, height: 60 };
  }

  if (is(element, 'bpmn:Lane')) {
    return { width: 300, height: 60 };
  }

  if (is(element, 'bpmn:DataObjectReference')) {
    return { width: 36, height: 50 };
  }

  if (is(element, 'bpmn:DataStoreReference')) {
    return { width: 50, height: 50 };
  }

  if (is(element, 'bpmn:TextAnnotation')) {
    return { width: 100, height: 40 };
  }

  return null;
}

export function is<Type extends BpmnTypeName>(
    element: unknown,
    type: Type
): element is BpmnElementFor<Type> {
  return isBpmnType(element, type);
}
