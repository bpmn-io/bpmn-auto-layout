import {
  HORIZONTAL_GAP,
  VERTICAL_GAP
} from '../Constants.js';
import {
  getExpandedChildEdges,
  getExtents,
  translateLayout
} from '../geometry/index.js';
import { collectCollaborationShapes } from './Helpers.js';
import {
  orderParticipantsByMessageFlow
} from './ordering/ParticipantOrdering.js';
import {
  alignParticipantComponentsLeft,
  alignParticipantsHorizontally,
  sizeAndPositionParticipantsFromMessageAnchors
} from './placement/ParticipantPlacement.js';
import {
  assignMessageFlowChannelOffsets
} from './routing/MessageFlowRouting.js';

/**
 * @typedef {import('../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * Own participant ordering, sizing, and coordinate publication.
 *
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function layoutParticipantGeometry(context) {
  const { collaboration, layout } = context;
  const {
    anchorPositioned,
    expandable,
    layouts
  } = context.participants;
  let shapes = collectCollaborationShapes(layout);
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

  stackParticipantRows(layout.shapes, layouts, order);

  const positions = alignParticipantsHorizontally(
    collaboration,
    layout.shapes,
    shapes,
    getExpandedChildEdges(layout),
    channelOffsets,
    anchorPositioned,
    expandable
  );

  applyParticipantPositions(layout.shapes, layouts, positions);

  shapes = collectCollaborationShapes(layout);
  sizeAndPositionParticipantsFromMessageAnchors(
    collaboration,
    layout.shapes,
    shapes,
    channelOffsets,
    anchorPositioned,
    expandable
  );

  alignDisconnectedParticipantComponents(
    collaboration,
    layout.shapes,
    layouts
  );
  compactParticipantRows(layout.shapes, layouts, order);

  return context;
}

function stackParticipantRows(participantShapes, layouts, order) {
  let nextY = 0;

  for (const participant of order) {
    const participantBounds = participantShapes.get(participant);
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
}

function applyParticipantPositions(participantShapes, layouts, positions) {
  for (const [ participant, x ] of positions) {
    const participantBounds = participantShapes.get(participant);
    const processLayout = layouts.get(participant);
    const dx = x - participantBounds.x;

    participantBounds.x = x;

    if (processLayout) {
      translateLayout(processLayout, dx, 0);
    }
  }
}

function alignDisconnectedParticipantComponents(
    collaboration,
    participantShapes,
    layouts) {
  for (const [ participant, dx ] of alignParticipantComponentsLeft(
    collaboration,
    participantShapes
  )) {
    const participantBounds = participantShapes.get(participant);
    const processLayout = layouts.get(participant);

    participantBounds.x += dx;

    if (processLayout) {
      translateLayout(processLayout, dx, 0);
    }
  }
}

function compactParticipantRows(participantShapes, layouts, order) {
  let nextY = 0;
  let collapsedRow = [];
  let collapsedRowY = 0;

  for (const participant of order) {
    const participantBounds = participantShapes.get(participant);
    const processLayout = layouts.get(participant);

    if (processLayout) {
      const extents = getExtents(processLayout);
      const hasProcessGeometry = processLayout.shapes.size > 0;
      const footprintTop = hasProcessGeometry
        ? Math.min(0, extents.minY - participantBounds.y)
        : 0;
      const footprintBottom = hasProcessGeometry
        ? Math.max(
          participantBounds.height,
          extents.maxY - participantBounds.y
        )
        : participantBounds.height;
      const participantY = nextY - footprintTop;
      const dy = participantY - participantBounds.y;

      participantBounds.y = participantY;
      translateLayout(processLayout, 0, dy);
      nextY += footprintBottom - footprintTop + VERTICAL_GAP;
      collapsedRow = [];
      continue;
    }

    const fitsCurrentRow = collapsedRow.length && collapsedRow.every(rect => {
      return rect.x + rect.width + HORIZONTAL_GAP <= participantBounds.x ||
        participantBounds.x + participantBounds.width + HORIZONTAL_GAP <=
          rect.x;
    });

    if (fitsCurrentRow) {
      participantBounds.y = collapsedRowY;
      collapsedRow.push(participantBounds);
      continue;
    }

    participantBounds.y = nextY;
    collapsedRowY = nextY;
    collapsedRow = [ participantBounds ];
    nextY += participantBounds.height + VERTICAL_GAP;
  }
}
