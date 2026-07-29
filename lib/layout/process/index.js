import { createLayout } from '../geometry/index.js';
import { analyzeSemantics } from './steps/analyzeSemantics.js';
import { extractElements } from './steps/extractElements.js';
import { layoutChildScopes } from './steps/layoutChildScopes.js';
import { placeArtifacts } from './steps/placeArtifacts.js';
import { placeEventSubProcesses } from './steps/placeEventSubProcesses.js';
import { placeExpandedChildren } from './steps/placeExpandedChildren.js';
import { placeFlowNodes } from './steps/placeFlowNodes.js';
import { placeGroups } from './steps/placeGroups.js';
import { routeSequenceFlows } from './steps/routeSequenceFlows.js';
import { validateScope } from './steps/validateScope.js';

/**
 * @typedef {import('../Types.js').ProcessLayoutStep} ProcessLayoutStep
 */

/** @type {ReadonlyArray<ProcessLayoutStep>} */
const PROCESS_LAYOUT_STEPS = Object.freeze([
  extractElements,
  layoutChildScopes,
  validateScope,
  analyzeSemantics,
  placeFlowNodes,
  placeExpandedChildren,
  routeSequenceFlows,
  placeEventSubProcesses,
  placeArtifacts,
  placeGroups
]);

/**
 * Lay out one process or sub-process through its fixed lifecycle.
 */
export function layoutProcessScope(scope, options = {}) {
  const layoutScope = (childScope, childOptions = {}) => {
    return layoutProcessScope(childScope, childOptions);
  };
  const context = createProcessLayoutContext(scope, {
    ...options,
    layoutScope
  });
  const completed = PROCESS_LAYOUT_STEPS.reduce((current, runStep) => {
    return runStep(current);
  }, context);

  return {
    layout: completed.layout,
    warnings: completed.warnings
  };
}

export { getParticipantContainerBounds } from './placement/ParticipantBounds.js';

function createProcessLayoutContext(
    scope,
    {
      expandedIds = new Set(),
      participantProcess = false,
      messageFlowEndpointDirections = new Map(),
      layoutScope
    }) {
  return {
    scope,
    options: {
      expandedIds,
      participantProcess,
      messageFlowEndpointDirections,
      layoutScope
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
