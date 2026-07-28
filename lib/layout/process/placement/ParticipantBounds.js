import {
  MIN_PARTICIPANT_HEIGHT,
  MIN_PARTICIPANT_WIDTH,
  PARTICIPANT_HEADER_WIDTH,
  SUB_PROCESS_PADDING
} from '../../Constants.js';
import {
  bounds,
  getParticipantContentExtents
} from '../../geometry/index.js';
import { flattenLanes } from './LanePlacement.js';

export function getParticipantContainerBounds(process, layout) {
  const extents = getParticipantContentExtents(layout);
  const hasLanes = flattenLanes(process.laneSets || []).length > 0;
  const leadingPadding = hasLanes
    ? PARTICIPANT_HEADER_WIDTH
    : PARTICIPANT_HEADER_WIDTH + SUB_PROCESS_PADDING;
  const trailingPadding = hasLanes ? 0 : SUB_PROCESS_PADDING;
  const verticalPadding = hasLanes ? 0 : SUB_PROCESS_PADDING;
  const width = Math.max(
    MIN_PARTICIPANT_WIDTH,
    extents.width + leadingPadding + trailingPadding
  );
  const height = Math.max(
    MIN_PARTICIPANT_HEIGHT,
    extents.height + 2 * verticalPadding
  );

  return bounds(
    extents.minX - leadingPadding,
    extents.minY - verticalPadding,
    width,
    height
  );
}
