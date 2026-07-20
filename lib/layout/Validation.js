import { is, getDefaultSize } from '../di/DiUtil.js';
import { LayoutError } from '../LayoutError.js';
import { isSupportedVisualElement } from './BpmnUtil.js';
import { MIN_LANES_FOR_ADJACENCY_VALIDATION } from './Constants.js';

export function validateSequenceFlows(flows, recordsByElement, scope) {
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

    if (!source || !target || !recordsByElement.has(source) || !recordsByElement.has(target)) {
      throw new LayoutError(
        'INVALID_SEQUENCE_FLOW_ENDPOINT',
        flow.id,
        'A sequence flow must reference source and target flow nodes in its scope.'
      );
    }

  }
}

export function validateMessageFlows(flows) {
  for (const flow of flows) {
    if (!flow.sourceRef || !flow.targetRef) {
      throw new LayoutError(
        'INVALID_MESSAGE_FLOW_ENDPOINT',
        flow.id,
        'A message flow must reference source and target interaction nodes.'
      );
    }
  }
}

export function validateLaneFlowPaths(scope, flows) {
  const lanes = scope.laneSets?.flatMap(laneSet => laneSet.lanes || []) || [];

  if (lanes.length < MIN_LANES_FOR_ADJACENCY_VALIDATION) {
    return;
  }

  const laneFor = node => lanes.find(lane => (lane.flowNodeRef || []).includes(node));

  for (const flow of flows) {
    const sourceLane = laneFor(flow.sourceRef);
    const targetLane = laneFor(flow.targetRef);

    if (!sourceLane || !targetLane) {
      continue;
    }

    const sourceIndex = lanes.indexOf(sourceLane);
    const targetIndex = lanes.indexOf(targetLane);

    if (Math.abs(sourceIndex - targetIndex) > 1) {
      throw new LayoutError(
        'ROUTING_FAILED',
        flow.id,
        'A sequence flow cannot traverse an unrelated lane.'
      );
    }
  }
}

export function validateBoundaryEvents(records, recordsByElement, scope) {
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

export function validateLinks(records, scope) {
  const events = records.filter(record => is(record.element, 'bpmn:IntermediateThrowEvent') ||
    is(record.element, 'bpmn:IntermediateCatchEvent'));
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
    const throws = elements.filter(element => is(element, 'bpmn:IntermediateThrowEvent'));
    const catches = elements.filter(element => is(element, 'bpmn:IntermediateCatchEvent'));

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

export function validateInputVisuals(definitions, root) {
  const diagram = (definitions.diagrams || []).find(candidate => candidate.plane?.bpmnElement === root);

  for (const di of diagram?.plane?.planeElement || []) {
    if (!di.$instanceOf('bpmndi:BPMNShape')) {
      continue;
    }

    const element = di.bpmnElement;

    if (!element || is(element, 'bpmn:Group') || (getDefaultSize(element) && isSupportedVisualElement(element))) {
      continue;
    }

    throw new LayoutError(
      'UNSUPPORTED_ELEMENT',
      element.id,
      `Cannot generate DI for visual BPMN element "${element.$type}".`
    );
  }
}

export function validateParseWarnings(warnings, xml) {
  const invalidProcessRef = warnings.find(warning => warning.property === 'bpmn:processRef');

  if (invalidProcessRef) {
    throw new LayoutError(
      'INVALID_PARTICIPANT_PROCESS_REFERENCE',
      invalidProcessRef.element.id,
      'A participant processRef must reference a declared process.'
    );
  }

  const unknownType = warnings.find(warning => warning.message.includes('unknown type'));

  if (unknownType) {
    const elementId = /<bpmn:[^ >]+[^>]*\sid="([^"]+)"/.exec(xml)?.[1] || 'unknown';

    throw new LayoutError(
      'UNSUPPORTED_ELEMENT',
      elementId,
      'Cannot generate DI for an unknown BPMN visual element.'
    );
  }
}
