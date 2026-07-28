import {
  isExteriorArtifact
} from '../../bpmn/Predicates.js';
import { placeArtifacts as layoutArtifacts } from '../../artifacts/index.js';
import {
  getParticipantContainerBounds
} from '../placement/ParticipantBounds.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function placeArtifacts(context) {
  const { layout, scope } = context;
  const { associations } = context.elements;
  const { records } = context.placement;
  const {
    messageFlowEndpointDirections,
    participantProcess
  } = context.options;

  if (!participantProcess) {
    layoutArtifacts({
      records,
      associations,
      layout,
      reservedVerticalEndpointDirections: messageFlowEndpointDirections
    });

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
    associations,
    layout,
    reservedVerticalEndpointDirections: messageFlowEndpointDirections
  });
  layoutArtifacts({
    records: exteriorArtifacts,
    associations,
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
