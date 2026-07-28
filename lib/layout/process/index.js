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
export const PROCESS_LAYOUT_STEPS = Object.freeze([
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
 * Lay out one process or sub-process using a composable sequence of transforms.
 * Callers may provide an internally customized step list.
 */
export function layoutProcessScope(scope, options = {}) {
  const steps = options.steps || PROCESS_LAYOUT_STEPS;
  const layoutScope = (childScope, childOptions = {}) => {
    return layoutProcessScope(childScope, {
      ...childOptions,
      steps
    });
  };
  const context = createProcessLayoutContext(scope, {
    ...options,
    layoutScope,
    steps
  });
  const completed = steps.reduce((current, runStep) => {
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
      steps,
      layoutScope
    }) {
  return {
    scope,
    options: {
      expandedIds,
      participantProcess,
      messageFlowEndpointDirections,
      steps,
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
