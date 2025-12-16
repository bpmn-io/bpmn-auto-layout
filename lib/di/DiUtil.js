export const DEFAULT_TASK_HEIGHT = 80;
export const DEFAULT_TASK_WIDTH = 100;

export function getDefaultSize(element) {
  if (is(element, 'bpmn:SubProcess')) {
    return { width: DEFAULT_TASK_WIDTH, height: DEFAULT_TASK_HEIGHT };
  }

  if (is(element, 'bpmn:Task')) {
    return { width: DEFAULT_TASK_WIDTH, height: DEFAULT_TASK_HEIGHT };
  }

  if (is(element, 'bpmn:Gateway')) {
    return { width: 50, height: 50 };
  }

  if (is(element, 'bpmn:Event')) {
    return { width: 36, height: 36 };
  }

  if (is(element, 'bpmn:Participant')) {
    return { width: 400, height: 100 };
  }

  if (is(element, 'bpmn:Lane')) {
    return { width: 400, height: 100 };
  }

  if (is(element, 'bpmn:DataObjectReference')) {
    return { width: 36, height: 50 };
  }

  if (is(element, 'bpmn:DataStoreReference')) {
    return { width: 50, height: 50 };
  }

  if (is(element, 'bpmn:TextAnnotation')) {
    return { width: DEFAULT_TASK_WIDTH, height: 30 };
  }

  return { width: DEFAULT_TASK_WIDTH, height: DEFAULT_TASK_HEIGHT };
}

export function is(element, type) {
  return element.$instanceOf(type);
}
