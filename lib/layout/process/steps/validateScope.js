import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';

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

function validateSequenceFlows(flows, recordsByElement, scope) {
  for (const flow of flows) {
    const source = flow.sourceRef;
    const target = flow.targetRef;

    if (source && target && (source.$parent !== scope || target.$parent !== scope)) {
      throw new LayoutError(
        'CROSS_SCOPE_SEQUENCE_FLOW',
        flow.id,
        'A sequence flow cannot cross a containment scope.',
        [ source.id, target.id ]
      );
    }

    if (
      !source ||
      !target ||
      !recordsByElement.has(source) ||
      !recordsByElement.has(target)
    ) {
      throw new LayoutError(
        'INVALID_SEQUENCE_FLOW_ENDPOINT',
        flow.id,
        'A sequence flow must reference source and target flow nodes in its scope.'
      );
    }
  }
}

function validateBoundaryEvents(records, recordsByElement, scope) {
  for (const record of records.filter(record => record.isBoundary)) {
    const host = record.element.attachedToRef;

    if (!host || !recordsByElement.has(host) || host.$parent !== scope) {
      throw new LayoutError(
        'INVALID_BOUNDARY_HOST',
        record.element.id,
        'A boundary event must attach to an activity in the same scope.',
        host?.id ? [ host.id ] : []
      );
    }
  }
}

function validateLinks(records, scope) {
  const events = records.filter(record => {
    return is(record.element, 'bpmn:IntermediateThrowEvent') ||
      is(record.element, 'bpmn:IntermediateCatchEvent');
  });
  const links = new Map();

  for (const record of events) {
    const definition = (record.element.eventDefinitions || []).find(candidate => {
      return is(candidate, 'bpmn:LinkEventDefinition');
    });

    if (!definition) {
      continue;
    }

    const name = definition.name || '';

    if (!links.has(name)) {
      links.set(name, []);
    }

    links.get(name).push(record.element);
  }

  for (const [ name, elements ] of links) {
    const throws = elements.filter(element => {
      return is(element, 'bpmn:IntermediateThrowEvent');
    });
    const catches = elements.filter(element => {
      return is(element, 'bpmn:IntermediateCatchEvent');
    });

    if (throws.length !== 1 || catches.length !== 1) {
      throw new LayoutError(
        'INVALID_LINK_EVENT_PAIR',
        elements[0].id,
        `Link event "${name}" must have exactly one throw and one catch in scope "${scope.id}".`,
        elements.map(element => element.id)
      );
    }
  }
}
