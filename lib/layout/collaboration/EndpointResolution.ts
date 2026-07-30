import { is } from '../../di/DiUtil.js';

import type { ModdleElement } from 'moddle';

import type { BpmnElement, BpmnElementFor } from '../bpmn/Types.js';
import type { Bounds } from '../Types.js';
import type { BpmnParticipant } from '../../moddle-types/bpmn.js';

type Collaboration = BpmnElementFor<'bpmn:Collaboration'>;
type Participant = ModdleElement<BpmnParticipant>;
type EndpointShapes = Map<BpmnElement, Bounds>;

export function findEndpointParticipant(
    endpoint: BpmnElement | undefined,
    collaboration: Collaboration
): Participant {
  if (is(endpoint, 'bpmn:Participant')) {
    return endpoint;
  }

  const process = findEndpointProcess(endpoint);

  return getRequired((collaboration.participants || [])
    .find(participant => participant.processRef === process));
}

export function findEndpointParticipantCached(
    endpoint: BpmnElement | undefined,
    participantsByProcess: Map<BpmnElement | undefined, Participant>
): Participant {
  if (is(endpoint, 'bpmn:Participant')) {
    return endpoint;
  }

  return getRequired(participantsByProcess.get(findEndpointProcess(endpoint)));
}

function findEndpointProcess(
    endpoint: BpmnElement | undefined
): BpmnElement | undefined {
  let parent = endpoint?.$parent;

  while (parent && !is(parent, 'bpmn:Process')) {
    parent = parent.$parent;
  }

  return parent;
}

export function resolveMessageFlowEndpoint(
    endpoint: BpmnElement | undefined,
    shapes: EndpointShapes
): BpmnElement {
  let visibleEndpoint = endpoint;

  while (visibleEndpoint && !shapes.has(visibleEndpoint)) {
    visibleEndpoint = visibleEndpoint.$parent;
  }

  return getRequired(visibleEndpoint);
}

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected message flow endpoint');
  }

  return value;
}
