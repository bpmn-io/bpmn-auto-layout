import { validateMessageFlows } from '../../bpmn/Validation.js';

/**
 * @typedef {import('../../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function validateCollaboration(context) {
  validateMessageFlows(context.collaboration.messageFlows || []);

  return context;
}
