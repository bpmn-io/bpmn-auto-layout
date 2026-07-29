import { LayoutError } from '../../../LayoutError.js';

/**
 * @typedef {import('../../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function validateCollaboration(context) {
  for (const flow of context.collaboration.messageFlows || []) {
    if (!flow.sourceRef || !flow.targetRef) {
      throw new LayoutError(
        'INVALID_MESSAGE_FLOW_ENDPOINT',
        flow.id,
        'A message flow must reference source and target interaction nodes.'
      );
    }
  }

  return context;
}
