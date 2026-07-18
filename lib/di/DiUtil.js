export const DEFAULT_TASK_HEIGHT = 80;
export const DEFAULT_TASK_WIDTH = 100;

export function getDefaultSize(element) {
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

export function is(element, type) {
  return !!element && element.$instanceOf(type);
}
