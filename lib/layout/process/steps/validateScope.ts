import type { ModdleElement } from 'moddle';

import type {
  BpmnElement,
  LayoutRecord,
  ProcessLayoutContext
} from '../../Types.js';
import type {
  BpmnBoundaryEvent,
  BpmnFlowNode,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';

type SequenceFlow = ModdleElement<BpmnSequenceFlow>;
type BoundaryEvent = ModdleElement<BpmnBoundaryEvent>;
type BoundaryRecord = LayoutRecord & { element: BoundaryEvent };
type RecordsByElement = Map<BpmnElement, LayoutRecord>;
type LinkEvent = ModdleElement<BpmnFlowNode> & { eventDefinitions?: BpmnElement[] };

function isLinkEvent(record: LayoutRecord): record is LayoutRecord & { element: LinkEvent } {
  return is(record.element, 'bpmn:IntermediateThrowEvent') ||
    is(record.element, 'bpmn:IntermediateCatchEvent');
}

function isBoundaryRecord(record: LayoutRecord): record is BoundaryRecord {
  return record.isBoundary && is(record.element, 'bpmn:BoundaryEvent');
}

import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected scope validation value');
  }

  return value;
}

export function validateScope(context: ProcessLayoutContext): ProcessLayoutContext {
  const { scope } = context;
  const { sequenceFlows } = context.elements;
  const { records, recordsByElement } = context.placement;

  validateSequenceFlows(
    sequenceFlows.filter((flow): flow is SequenceFlow => is(flow, 'bpmn:SequenceFlow')),
    recordsByElement,
    scope
  );
  validateBoundaryEvents(records, recordsByElement, scope);
  validateLinks(records, scope);

  return context;
}

function validateSequenceFlows(flows: SequenceFlow[], recordsByElement: RecordsByElement, scope: BpmnElement): void {
  for (const flow of flows) {
    const source = flow.sourceRef;
    const target = flow.targetRef;

    if (source && target && (source.$parent !== scope || target.$parent !== scope)) {
      throw new LayoutError(
        'CROSS_SCOPE_SEQUENCE_FLOW',
        flow.id,
        'A sequence flow cannot cross a containment scope.',
        [ source.id, target.id ].filter((id): id is string => typeof id === 'string')
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

function validateBoundaryEvents(records: LayoutRecord[], recordsByElement: RecordsByElement, scope: BpmnElement): void {
  for (const record of records.filter(isBoundaryRecord)) {
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

function validateLinks(records: LayoutRecord[], scope: BpmnElement): void {
  const events = records.filter(isLinkEvent);
  const links = new Map<string, LinkEvent[]>();

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

    getRequired(links.get(name)).push(record.element);
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
        getRequired(elements[0]).id,
        `Link event "${name}" must have exactly one throw and one catch in scope "${scope.id}".`,
        elements.map(element => element.id)
          .filter((id): id is string => typeof id === 'string')
      );
    }
  }
}
