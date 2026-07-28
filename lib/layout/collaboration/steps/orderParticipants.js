import { VERTICAL_GAP } from '../../Constants.js';
import {
  getExtents,
  translateLayout
} from '../../geometry/index.js';
import {
  orderParticipantsByMessageFlow
} from '../ordering/ParticipantOrdering.js';
import {
  sizeAndPositionParticipantsFromMessageAnchors
} from '../placement/ParticipantPlacement.js';
import {
  assignMessageFlowChannelOffsets
} from '../routing/MessageFlowRouting.js';
import { collectCollaborationShapes } from '../Helpers.js';

/**
 * @typedef {import('../../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function orderParticipants(context) {
  const { collaboration, layout } = context;
  const {
    anchorPositioned,
    expandable,
    layouts
  } = context.participants;
  const shapes = collectCollaborationShapes(layout);
  const channelOffsets = assignMessageFlowChannelOffsets(
    collaboration,
    shapes
  );

  context.routing.channelOffsets = channelOffsets;

  sizeAndPositionParticipantsFromMessageAnchors(
    collaboration,
    layout.shapes,
    shapes,
    channelOffsets,
    anchorPositioned,
    expandable
  );

  const order = orderParticipantsByMessageFlow(
    collaboration,
    layout.shapes,
    shapes
  );

  context.participants.order = order;

  let nextY = 0;

  for (const participant of order) {
    const participantBounds = layout.shapes.get(participant);
    const processLayout = layouts.get(participant);

    if (processLayout) {
      const extents = getExtents(processLayout);
      const footprintTop = Math.min(0, extents.minY);
      const footprintBottom = Math.max(
        participantBounds.height,
        extents.maxY
      );
      const participantY = nextY - footprintTop;

      participantBounds.y = participantY;
      translateLayout(processLayout, 0, participantY);
      nextY += footprintBottom - footprintTop + VERTICAL_GAP;
    } else {
      participantBounds.y = nextY;
      nextY += participantBounds.height + VERTICAL_GAP;
    }
  }

  return context;
}
