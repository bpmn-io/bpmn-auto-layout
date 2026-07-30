import { is } from '../../../di/DiUtil.js';
import { placeArtifacts as layoutArtifacts } from '../../artifacts/index.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import { layoutGroups } from '../../groups/LayoutGroups.js';
import { isBpmnType } from '../../bpmn/Types.js';

import type { BpmnElementFor } from '../../bpmn/Types.js';
import type { CollaborationLayoutContext } from '../../Types.js';

type Collaboration = BpmnElementFor<'bpmn:Collaboration'>;
import { createLayoutRecord } from '../../process/LayoutRecord.js';

export function placeArtifacts(
    context: CollaborationLayoutContext
): CollaborationLayoutContext {
  const { layout, warnings } = context;
  const collaboration = getCollaboration(context);
  const { expandedIds } = context.options;
  const artifacts = collaboration.artifacts || [];
  const participants = getRequired(collaboration.participants);
  const groups = artifacts.filter(element => is(element, 'bpmn:Group'));
  const records = artifacts
    .filter(element => {
      return isArtifact(element) && !is(element, 'bpmn:Group');
    })
    .map((element, index) => {
      return createLayoutRecord(element, index, expandedIds);
    });
  const associations = artifacts.filter(element => {
    return isBpmnType(element, 'bpmn:Association');
  });

  layoutArtifacts({
    records,
    associations,
    layout,
    reservedVerticalEndpointDirections: new Map(),
    avoidParticipantInterior: participants.length === 1,
    preferParticipantSides: participants.length !== 1
  });
  warnings.push(...layoutGroups(groups, layout));

  return context;
}


function getCollaboration(context: CollaborationLayoutContext): Collaboration {
  if (!isBpmnType(context.collaboration, 'bpmn:Collaboration')) {
    throw new Error('Expected BPMN collaboration');
  }

  return context.collaboration;
}


function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected collaboration participants');
  }

  return value;
}
