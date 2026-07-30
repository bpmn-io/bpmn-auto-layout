import { flattenLanes } from '../process/placement/LanePlacement.js';
import {
  isSupportedVisualConnection,
  isSupportedVisualElement
} from './Predicates.js';
import {
  isBpmnElement,
  isBpmnType,
  type BpmnElement
} from './Types.js';

export function getExpectedDiElements(root: BpmnElement): Set<BpmnElement> {
  const elements = new Set<BpmnElement>();
  const scopes = new Set<BpmnElement>();

  const addIfExpected = (element: BpmnElement) => {
    if (
      isSupportedVisualElement(element) ||
      isSupportedVisualConnection(element)
    ) {
      elements.add(element);
    }
  };

  const collectScope = (scope: BpmnElement) => {
    if (scopes.has(scope)) {
      return;
    }

    if (
      !isBpmnType(scope, 'bpmn:Process') &&
      !isBpmnType(scope, 'bpmn:SubProcess')
    ) {
      return;
    }

    scopes.add(scope);
    flattenLanes(scope.laneSets || [])
      .filter(isBpmnElement)
      .forEach(addIfExpected);

    for (const element of scope.flowElements || []) {
      addIfExpected(element);

      const dataInputAssociations = 'dataInputAssociations' in element &&
        Array.isArray(element.dataInputAssociations)
        ? element.dataInputAssociations
        : [];
      const dataOutputAssociations = 'dataOutputAssociations' in element &&
        Array.isArray(element.dataOutputAssociations)
        ? element.dataOutputAssociations
        : [];
      for (const association of [
        ...(dataInputAssociations || []),
        ...(dataOutputAssociations || [])
      ].filter(isBpmnElement)) {
        addIfExpected(association);
      }

      if (isBpmnType(element, 'bpmn:SubProcess')) {
        collectScope(element);
      }
    }

    (scope.artifacts || []).forEach(addIfExpected);
  };

  if (isBpmnType(root, 'bpmn:Collaboration')) {
    (root.participants || []).forEach(addIfExpected);
    (root.messageFlows || []).forEach(addIfExpected);
    (root.artifacts || []).forEach(addIfExpected);

    for (const participant of root.participants || []) {
      if (participant.processRef) {
        collectScope(participant.processRef);
      }
    }
  } else {
    collectScope(root);
  }

  return elements;
}
