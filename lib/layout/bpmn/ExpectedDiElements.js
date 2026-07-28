import { is } from '../../di/DiUtil.js';
import { flattenLanes } from '../process/placement/LanePlacement.js';
import {
  isSupportedVisualConnection,
  isSupportedVisualElement
} from './Predicates.js';

export function getExpectedDiElements(root) {
  const elements = new Set();
  const scopes = new Set();

  const addIfExpected = element => {
    if (
      isSupportedVisualElement(element) ||
      isSupportedVisualConnection(element)
    ) {
      elements.add(element);
    }
  };

  const collectScope = scope => {
    if (scopes.has(scope)) {
      return;
    }

    scopes.add(scope);
    flattenLanes(scope.laneSets || []).forEach(addIfExpected);

    for (const element of scope.flowElements || []) {
      addIfExpected(element);

      for (const association of [
        ...(element.dataInputAssociations || []),
        ...(element.dataOutputAssociations || [])
      ]) {
        addIfExpected(association);
      }

      if (is(element, 'bpmn:SubProcess')) {
        collectScope(element);
      }
    }

    (scope.artifacts || []).forEach(addIfExpected);
  };

  if (is(root, 'bpmn:Collaboration')) {
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
