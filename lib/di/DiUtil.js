export function getDefaultSize(element) {
  if (is(element, 'bpmn:SubProcess')) {
    return { width: 100, height: 80 };
  }

  if (is(element, 'bpmn:Task')) {
    return { width: 100, height: 80 };
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
    return { width: 100, height: 30 };
  }

  return { width: 100, height: 80 };
}

export function is(element, type) {
  return element.$instanceOf(type);
}
