import {
  isExteriorArtifact
} from '../../bpmn/Predicates.js';
import { isBpmnType } from '../../bpmn/Types.js';

import type { BpmnElementFor } from '../../bpmn/Types.js';
import { placeArtifacts as layoutArtifacts } from '../../artifacts/index.js';
import {
  getParticipantContainerBounds
} from '../placement/ParticipantBounds.js';

import type { ProcessLayoutContext } from '../../Types.js';

type ArtifactAssociation =
  | BpmnElementFor<'bpmn:Association'>
  | BpmnElementFor<'bpmn:DataAssociation'>;

export function placeArtifacts(context: ProcessLayoutContext): ProcessLayoutContext {
  const { layout, scope } = context;
  const { associations } = context.elements;
  const { records } = context.placement;
  const {
    messageFlowEndpointDirections,
    participantProcess
  } = context.options;

  const artifactAssociations = associations.filter(isArtifactAssociation);

  if (!participantProcess) {
    layoutArtifacts({
      records,
      associations: artifactAssociations,
      layout,
      reservedVerticalEndpointDirections: messageFlowEndpointDirections
    });

    return context;
  }

  if (!isBpmnType(scope, 'bpmn:Process')) {
    return context;
  }

  const interiorArtifacts = records.filter(record => {
    return record.isArtifact && !isExteriorArtifact(record.element);
  });
  const exteriorArtifacts = records.filter(record => {
    return record.isArtifact && isExteriorArtifact(record.element);
  });

  layoutArtifacts({
    records: interiorArtifacts,
    associations: artifactAssociations,
    layout,
    reservedVerticalEndpointDirections: messageFlowEndpointDirections
  });
  layoutArtifacts({
    records: exteriorArtifacts,
    associations: artifactAssociations,
    layout,
    additionalBoundaryContainers: [ {
      rect: getParticipantContainerBounds(scope, layout),
      containsOwner: true,
      participant: true
    } ],
    reservedVerticalEndpointDirections: messageFlowEndpointDirections
  });

  return context;
}


function isArtifactAssociation(
    element: ProcessLayoutContext['elements']['associations'][number]
): element is ArtifactAssociation {
  return isBpmnType(element, 'bpmn:Association') ||
    isBpmnType(element, 'bpmn:DataAssociation');
}
