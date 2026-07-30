import { getDefaultSize } from '../../../di/DiUtil.js';
import {
  bounds,
  hasParticipantContent,
  translateLayout
} from '../../geometry/index.js';
import {
  getParticipantContainerBounds,
  layoutProcessScope
} from '../../process/index.js';
import { collectMessageFlowEndpointDirections } from '../Helpers.js';
import { isBpmnType } from '../../bpmn/Types.js';

import type { BpmnElementFor } from '../../bpmn/Types.js';
import type { CollaborationLayoutContext } from '../../Types.js';

type Collaboration = BpmnElementFor<'bpmn:Collaboration'>;

export function layoutParticipants(
    context: CollaborationLayoutContext
): CollaborationLayoutContext {
  const { layout, warnings } = context;
  const collaboration = getCollaboration(context);
  const { expandedIds } = context.options;
  const {
    layouts,
    anchorPositioned,
    expandable
  } = context.participants;
  const endpointDirections = collectMessageFlowEndpointDirections(
    collaboration.messageFlows || []
  );

  context.routing.endpointDirections = endpointDirections;

  for (const participant of collaboration.participants || []) {
    const process = participant.processRef;

    if (!process) {
      const size = getRequired(getDefaultSize(participant));

      layout.shapes.set(participant, bounds(
        0,
        0,
        size.width,
        size.height
      ));
      anchorPositioned.add(participant);
      expandable.add(participant);
      continue;
    }

    const processResult = layoutProcessScope(process, {
      expandedIds,
      participantProcess: true,
      messageFlowEndpointDirections: endpointDirections
    });
    const processLayout = processResult.layout;
    const participantRect = getParticipantContainerBounds(
      process,
      processLayout
    );

    warnings.push(...processResult.warnings);
    translateLayout(
      processLayout,
      -participantRect.x,
      -participantRect.y
    );
    layout.shapes.set(participant, bounds(
      0,
      0,
      participantRect.width,
      participantRect.height
    ));
    layouts.set(participant, processLayout);

    if (!hasParticipantContent(processLayout)) {
      anchorPositioned.add(participant);
      expandable.add(participant);
    }

    processLayout.emitInParent = true;
    layout.children.push(processLayout);
  }

  return context;
}


function getCollaboration(context: CollaborationLayoutContext): Collaboration {
  if (!isBpmnType(context.collaboration, 'bpmn:Collaboration')) {
    throw new Error('Expected BPMN collaboration');
  }

  return context.collaboration;
}

function getRequired<Value>(value: Value | null): Value {
  if (value === null) {
    throw new Error('Expected participant default size');
  }

  return value;
}
