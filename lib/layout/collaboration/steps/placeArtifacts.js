import { is } from '../../../di/DiUtil.js';
import { placeArtifacts as layoutArtifacts } from '../../artifacts/index.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import { layoutGroups } from '../../groups/LayoutGroups.js';
import { createLayoutRecord } from '../../process/LayoutRecord.js';

/**
 * @typedef {import('../../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function placeArtifacts(context) {
  const { collaboration, layout, warnings } = context;
  const { expandedIds } = context.options;
  const artifacts = collaboration.artifacts || [];
  const groups = artifacts.filter(element => is(element, 'bpmn:Group'));
  const records = artifacts
    .filter(element => {
      return isArtifact(element) && !is(element, 'bpmn:Group');
    })
    .map((element, index) => {
      return createLayoutRecord(element, index, expandedIds);
    });
  const associations = artifacts.filter(element => {
    return is(element, 'bpmn:Association');
  });

  layoutArtifacts({
    records,
    associations,
    layout,
    reservedVerticalEndpointDirections: new Map(),
    avoidParticipantInterior: collaboration.participants.length === 1,
    preferParticipantSides: collaboration.participants.length !== 1
  });
  warnings.push(...layoutGroups(groups, layout));

  return context;
}
