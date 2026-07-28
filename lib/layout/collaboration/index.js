import { createCollaborationLayoutContext } from './Context.js';
import { runCollaborationPipeline } from './Pipeline.js';
import { compactParticipantRows } from './steps/compactParticipantRows.js';
import { layoutParticipants } from './steps/layoutParticipants.js';
import { orderParticipants } from './steps/orderParticipants.js';
import { placeArtifacts } from './steps/placeArtifacts.js';
import { positionParticipants } from './steps/positionParticipants.js';
import { routeMessageFlows } from './steps/routeMessageFlows.js';
import {
  validateCollaboration
} from './steps/validateCollaboration.js';

/**
 * @typedef {import('../Types.js').CollaborationLayoutStep} CollaborationLayoutStep
 */

/** @type {ReadonlyArray<CollaborationLayoutStep>} */
export const COLLABORATION_LAYOUT_STEPS = Object.freeze([
  validateCollaboration,
  layoutParticipants,
  orderParticipants,
  positionParticipants,
  compactParticipantRows,
  routeMessageFlows,
  placeArtifacts
]);

export function layoutCollaboration(collaboration, options = {}) {
  const context = runCollaborationPipeline(
    createCollaborationLayoutContext(collaboration, {
      ...options,
      steps: options.steps || COLLABORATION_LAYOUT_STEPS
    })
  );

  return {
    layout: context.layout,
    warnings: context.warnings
  };
}

export {
  createCollaborationLayoutContext
} from './Context.js';
