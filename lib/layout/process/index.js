import { createProcessLayoutContext } from './Context.js';
import { runProcessPipeline } from './Pipeline.js';
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
  const context = runProcessPipeline(createProcessLayoutContext(scope, {
    ...options,
    steps: options.steps || PROCESS_LAYOUT_STEPS
  }));

  return {
    layout: context.layout,
    warnings: context.warnings
  };
}

export {
  createLayoutRecord,
  createProcessLayoutContext
} from './Context.js';
export { getParticipantContainerBounds } from './placement/ParticipantBounds.js';
