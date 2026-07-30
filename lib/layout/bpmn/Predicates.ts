import {
  isBpmndiType,
  isBpmnType,
  type BpmnElement,
  type BpmnTypeName
} from './Types.js';

export function isArtifact(element: BpmnElement): boolean {
  return isBpmnType(element, 'bpmn:TextAnnotation') ||
    isBpmnType(element, 'bpmn:DataObjectReference') ||
    isBpmnType(element, 'bpmn:DataStoreReference') ||
    isBpmnType(element, 'bpmn:Group');
}

export function isExteriorArtifact(element: BpmnElement): boolean {
  return isBpmnType(element, 'bpmn:TextAnnotation') ||
    isBpmnType(element, 'bpmn:DataStoreReference');
}

export function isExternalLabelOwner(element: BpmnElement): boolean {
  return isBpmnType(element, 'bpmn:Event') ||
    isBpmnType(element, 'bpmn:Gateway') ||
    isBpmnType(element, 'bpmn:DataStoreReference') ||
    isBpmnType(element, 'bpmn:DataObjectReference') ||
    isBpmnType(element, 'bpmn:SequenceFlow') ||
    isBpmnType(element, 'bpmn:MessageFlow') ||
    isBpmnType(element, 'bpmn:Group');
}

export function getExternalLabelText(element: BpmnElement): string {
  if (isBpmnType(element, 'bpmn:Group')) {
    return element.categoryValueRef?.value || '';
  }

  return 'name' in element && typeof element.name === 'string'
    ? element.name
    : '';
}

export function hasSubProcessLabel(element: BpmnElement): boolean {
  return isBpmnType(element, 'bpmn:SubProcess') && !!element.name?.trim();
}

export function hasEventDefinition(
    event: BpmnElement,
    type: BpmnTypeName
): boolean {
  const eventWithDefinitions = isBpmnType(event, 'bpmn:CatchEvent')
    ? event
    : isBpmnType(event, 'bpmn:ThrowEvent')
      ? event
      : null;

  return !!eventWithDefinitions &&
    (eventWithDefinitions.eventDefinitions || []).some(definition => {
      return isBpmnType(definition, type);
    });
}

export function isSupportedVisualElement(element: BpmnElement): boolean {
  return isBpmnType(element, 'bpmn:Activity') ||
    isBpmnType(element, 'bpmn:Event') ||
    (isBpmnType(element, 'bpmn:Gateway') &&
      !isBpmnType(element, 'bpmn:ComplexGateway')) ||
    isArtifact(element) ||
    isBpmnType(element, 'bpmn:Participant') ||
    isBpmnType(element, 'bpmn:Lane');
}

export function isSupportedVisualConnection(element: BpmnElement): boolean {
  return isBpmnType(element, 'bpmn:SequenceFlow') ||
    isBpmnType(element, 'bpmn:MessageFlow') ||
    isBpmnType(element, 'bpmn:Association') ||
    isBpmnType(element, 'bpmn:DataAssociation');
}

export function getExpandedIds(
    definitions: BpmnElement,
    root: BpmnElement
): Set<string> {
  if (!isBpmnType(definitions, 'bpmn:Definitions')) {
    return new Set();
  }
  const diagram = (definitions.diagrams || []).find(candidate => candidate.plane?.bpmnElement === root);
  const ids = new Set<string>();

  for (const element of diagram?.plane?.planeElement || []) {
    if (
      isBpmndiType(element, 'bpmndi:BPMNShape') &&
      element.isExpanded === true &&
      typeof element.bpmnElement?.id === 'string'
    ) {
      ids.add(element.bpmnElement.id);
    }
  }

  return ids;
}
