import {
  getExpandedChildEdges,
  translateLayout
} from '../../geometry/index.js';
import {
  alignParticipantComponentsLeft,
  alignParticipantsHorizontally,
  sizeAndPositionParticipantsFromMessageAnchors
} from '../placement/ParticipantPlacement.js';
import { collectCollaborationShapes } from '../Helpers.js';

/**
 * @typedef {import('../../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function positionParticipants(context) {
  const { collaboration, layout } = context;
  const {
    anchorPositioned,
    expandable,
    layouts
  } = context.participants;
  const { channelOffsets } = context.routing;
  let shapes = collectCollaborationShapes(layout);
  const positions = alignParticipantsHorizontally(
    collaboration,
    layout.shapes,
    shapes,
    getExpandedChildEdges(layout),
    channelOffsets,
    anchorPositioned,
    expandable
  );

  for (const [ participant, x ] of positions) {
    const participantBounds = layout.shapes.get(participant);
    const processLayout = layouts.get(participant);
    const dx = x - participantBounds.x;

    participantBounds.x = x;

    if (processLayout) {
      translateLayout(processLayout, dx, 0);
    }
  }

  shapes = collectCollaborationShapes(layout);
  sizeAndPositionParticipantsFromMessageAnchors(
    collaboration,
    layout.shapes,
    shapes,
    channelOffsets,
    anchorPositioned,
    expandable
  );

  for (const [ participant, dx ] of alignParticipantComponentsLeft(
    collaboration,
    layout.shapes
  )) {
    const participantBounds = layout.shapes.get(participant);
    const processLayout = layouts.get(participant);

    participantBounds.x += dx;

    if (processLayout) {
      translateLayout(processLayout, dx, 0);
    }
  }

  return context;
}
