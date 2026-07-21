import { is } from '../di/DiUtil.js';

export function isArtifact(element) {
  return is(element, 'bpmn:TextAnnotation') ||
    is(element, 'bpmn:DataObjectReference') ||
    is(element, 'bpmn:DataStoreReference') ||
    is(element, 'bpmn:Group');
}

export function isExteriorArtifact(element) {
  return is(element, 'bpmn:TextAnnotation') ||
    is(element, 'bpmn:DataStoreReference');
}

export function isExternalLabelOwner(element) {
  return is(element, 'bpmn:Event') ||
    is(element, 'bpmn:Gateway') ||
    is(element, 'bpmn:DataStoreReference') ||
    is(element, 'bpmn:DataObjectReference') ||
    is(element, 'bpmn:SequenceFlow') ||
    is(element, 'bpmn:MessageFlow') ||
    is(element, 'bpmn:Group');
}

export function getExternalLabelText(element) {
  if (is(element, 'bpmn:Group')) {
    return element.categoryValueRef?.value || '';
  }

  return element.name || '';
}

export function hasSubProcessLabel(element) {
  return is(element, 'bpmn:SubProcess') && !!element.name?.trim();
}

export function hasEventDefinition(event, type) {
  return (event.eventDefinitions || []).some(definition => is(definition, type));
}

export function isSupportedVisualElement(element) {
  return is(element, 'bpmn:Activity') ||
    is(element, 'bpmn:Event') ||
    (is(element, 'bpmn:Gateway') && !is(element, 'bpmn:ComplexGateway')) ||
    isArtifact(element) ||
    is(element, 'bpmn:Participant') ||
    is(element, 'bpmn:Lane');
}

export function getExpandedIds(definitions, root) {
  const diagram = (definitions.diagrams || []).find(candidate => candidate.plane?.bpmnElement === root);
  const ids = new Set();

  for (const element of diagram?.plane?.planeElement || []) {
    if (element.$instanceOf('bpmndi:BPMNShape') && element.isExpanded === true) {
      ids.add(element.bpmnElement.id);
    }
  }

  return ids;
}
