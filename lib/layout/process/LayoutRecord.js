import { getDefaultSize, is } from '../../di/DiUtil.js';
import { LayoutError } from '../../LayoutError.js';
import {
  isArtifact,
  isSupportedVisualElement
} from '../bpmn/Predicates.js';

/**
 * @typedef {import('../Types.js').BpmnElement} BpmnElement
 * @typedef {import('../Types.js').LayoutRecord} LayoutRecord
 */

/**
 * @param {BpmnElement} element
 * @param {number} index
 * @param {Set<string>} expandedIds
 * @returns {LayoutRecord}
 */
export function createLayoutRecord(element, index, expandedIds = new Set()) {
  const size = getDefaultSize(element);

  if (!size || !isSupportedVisualElement(element)) {
    throw new LayoutError(
      'UNSUPPORTED_ELEMENT',
      element.id,
      `Cannot generate DI for visual BPMN element "${element.$type}".`
    );
  }

  return {
    element,
    index,
    size,
    isBoundary: is(element, 'bpmn:BoundaryEvent'),
    isArtifact: isArtifact(element),
    expanded: is(element, 'bpmn:SubProcess') && expandedIds.has(element.id),
    child: null
  };
}
