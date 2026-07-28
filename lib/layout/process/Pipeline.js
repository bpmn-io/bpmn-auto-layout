/**
 * @typedef {import('../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function runProcessPipeline(context) {
  return context.options.steps.reduce((current, runStep) => {
    return runStep(current);
  }, context);
}
