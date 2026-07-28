import { is } from '../../di/DiUtil.js';

export function findEndpointParticipant(endpoint, collaboration) {
  if (is(endpoint, 'bpmn:Participant')) {
    return endpoint;
  }

  const process = findEndpointProcess(endpoint);

  return (collaboration.participants || [])
    .find(participant => participant.processRef === process);
}

export function findEndpointParticipantCached(endpoint, participantsByProcess) {
  if (is(endpoint, 'bpmn:Participant')) {
    return endpoint;
  }

  return participantsByProcess.get(findEndpointProcess(endpoint));
}

function findEndpointProcess(endpoint) {
  let parent = endpoint?.$parent;

  while (parent && !is(parent, 'bpmn:Process')) {
    parent = parent.$parent;
  }

  return parent;
}

export function resolveMessageFlowEndpoint(endpoint, shapes) {
  let visibleEndpoint = endpoint;

  while (visibleEndpoint && !shapes.has(visibleEndpoint)) {
    visibleEndpoint = visibleEndpoint.$parent;
  }

  return visibleEndpoint;
}
