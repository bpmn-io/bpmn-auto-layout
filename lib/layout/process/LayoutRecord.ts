import { getDefaultSize, is } from '../../di/DiUtil.js';
import { LayoutError } from '../../LayoutError.js';
import {
  isArtifact,
  isSupportedVisualElement
} from '../bpmn/Predicates.js';

import type {
  BpmnElement,
  LayoutRecord
} from '../Types.js';

export function createLayoutRecord(
    element: BpmnElement,
    index: number,
    expandedIds: Set<string> = new Set()
): LayoutRecord {
  const size = getDefaultSize(element);
  const elementId = typeof element.id === 'string' ? element.id : undefined;

  if (!size || !isSupportedVisualElement(element)) {
    throw new LayoutError(
      'UNSUPPORTED_ELEMENT',
      elementId,
      `Cannot generate DI for visual BPMN element "${element.$type}".`
    );
  }

  return {
    element,
    index,
    size,
    isBoundary: is(element, 'bpmn:BoundaryEvent'),
    isArtifact: isArtifact(element),
    expanded: is(element, 'bpmn:SubProcess') &&
      !!elementId &&
      expandedIds.has(elementId),
    child: null
  };
}
