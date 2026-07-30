import {
  MIN_SUB_PROCESS_HEIGHT,
  MIN_SUB_PROCESS_WIDTH,
  SUB_PROCESS_PADDING
} from '../../Constants.js';

import type { ElementSize } from '../../../di/DiUtil.js';
import type { Extents } from '../../geometry/Geometry.js';

export function sizeExpandedSubProcess(
    childExtents: Extents
): ElementSize {
  return {
    width: Math.max(
      MIN_SUB_PROCESS_WIDTH,
      childExtents.width + 2 * SUB_PROCESS_PADDING
    ),
    height: Math.max(
      MIN_SUB_PROCESS_HEIGHT,
      childExtents.height + 2 * SUB_PROCESS_PADDING
    )
  };
}
