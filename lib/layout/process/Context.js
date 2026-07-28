import { getDefaultSize, is } from '../../di/DiUtil.js';
import { LayoutError } from '../../LayoutError.js';
import {
  isArtifact,
  isSupportedVisualElement
} from '../bpmn/Predicates.js';
import { createLayout } from '../geometry/index.js';

/**
 * @typedef {import('../Types.js').ProcessLayoutContext} ProcessLayoutContext
 * @typedef {import('../Types.js').ProcessLayoutOptions} ProcessLayoutOptions
 */

/**
 * @param {Object} scope
 * @param {Partial<ProcessLayoutOptions>} options
 * @returns {ProcessLayoutContext}
 */
export function createProcessLayoutContext(
    scope,
    {
      expandedIds = new Set(),
      participantProcess = false,
      messageFlowEndpointDirections = new Map(),
      steps = []
    } = {}) {
  return {
    scope,
    options: {
      expandedIds,
      participantProcess,
      messageFlowEndpointDirections,
      steps
    },
    elements: {
      groups: [],
      sequenceFlows: [],
      associations: []
    },
    graph: {
      nodes: [],
      edges: [],
      boundaryEdges: []
    },
    semantics: {
      policy: null,
      ranks: null
    },
    placement: {
      records: [],
      recordsByElement: new Map()
    },
    layout: createLayout(scope),
    warnings: []
  };
}

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
