import {
  validateBoundaryEvents,
  validateLinks,
  validateSequenceFlows
} from '../../bpmn/Validation.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function validateScope(context) {
  const { scope } = context;
  const { sequenceFlows } = context.elements;
  const { records, recordsByElement } = context.placement;

  validateSequenceFlows(sequenceFlows, recordsByElement, scope);
  validateBoundaryEvents(records, recordsByElement, scope);
  validateLinks(records, scope);

  return context;
}
