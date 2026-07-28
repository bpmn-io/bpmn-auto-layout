import {
  HORIZONTAL_GAP,
  VERTICAL_GAP
} from '../../Constants.js';
import {
  getExtents,
  translateLayout
} from '../../geometry/index.js';

/**
 * @typedef {import('../../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function compactParticipantRows(context) {
  const { layout } = context;
  const { layouts, order } = context.participants;
  let nextY = 0;
  let collapsedRow = [];
  let collapsedRowY = 0;

  for (const participant of order) {
    const participantBounds = layout.shapes.get(participant);
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

  return context;
}
