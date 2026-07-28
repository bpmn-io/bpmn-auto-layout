/**
 * @typedef {import('../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function runCollaborationPipeline(context) {
  return context.options.steps.reduce((current, runStep) => {
    return runStep(current);
  }, context);
}
