import {
  EXPANDED_SUBPROCESS_LABEL_HEIGHT,
  SUB_PROCESS_PADDING
} from '../../Constants.js';
import {
  getExtents,
  translateLayout
} from '../../geometry/index.js';
import {
  needsExpandedSubProcessTitleClearance
} from '../../labels/LayoutLabels.js';

import type { ProcessLayoutContext } from '../../Types.js';

export function placeExpandedChildren(context: ProcessLayoutContext): ProcessLayoutContext {
  for (const record of context.placement.records) {
    if (!record.expanded || !record.child || !record.bounds) {
      continue;
    }

    const extents = getExtents(record.child);

    translateLayout(
      record.child,
      record.bounds.x + SUB_PROCESS_PADDING - extents.minX,
      record.bounds.y + SUB_PROCESS_PADDING - extents.minY
    );
    record.child.emitInParent = true;

    if (needsExpandedSubProcessTitleClearance(
      record.element,
      record.bounds,
      record.child
    )) {
      translateLayout(record.child, 0, EXPANDED_SUBPROCESS_LABEL_HEIGHT);
    }
  }

  return context;
}
