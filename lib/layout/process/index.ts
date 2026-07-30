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

import type {
  BpmnElement,
  ProcessLayoutContext,
  ProcessLayoutOptions,
  ProcessLayoutResult,
  ProcessLayoutStep
} from '../Types.js';

type ProcessLayoutContextOptions =
  & Pick<ProcessLayoutOptions, 'layoutScope'>
  & Partial<Omit<ProcessLayoutOptions, 'layoutScope'>>;

const PROCESS_LAYOUT_STEPS: readonly ProcessLayoutStep[] = Object.freeze([
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
export function layoutProcessScope(
    scope: BpmnElement,
    options: Partial<ProcessLayoutOptions> = {}
): ProcessLayoutResult {
  const layoutScope = (
      childScope: BpmnElement,
      childOptions: Partial<ProcessLayoutOptions> = {}
  ) => {
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
    scope: BpmnElement,
    {
      expandedIds = new Set<string>(),
      participantProcess = false,
      messageFlowEndpointDirections = new Map<BpmnElement, Set<string>>(),
      layoutScope
    }: ProcessLayoutContextOptions
): ProcessLayoutContext {
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
