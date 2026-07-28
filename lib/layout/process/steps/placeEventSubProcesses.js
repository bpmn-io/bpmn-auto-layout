import { is } from '../../../di/DiUtil.js';
import {
  SUB_PROCESS_PADDING,
  VERTICAL_GAP
} from '../../Constants.js';
import {
  bounds,
  getExtents,
  translateLayout
} from '../../geometry/index.js';
import {
  sizeExpandedSubProcess
} from '../placement/ExpandedSubProcess.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function placeEventSubProcesses(context) {
  const { layout } = context;
  const { records } = context.placement;
  const eventSubProcesses = records.filter(record => {
    return is(record.element, 'bpmn:SubProcess') &&
      record.element.triggeredByEvent;
  });
  let nextY = getExtents(layout).maxY + VERTICAL_GAP;

  for (const record of eventSubProcesses) {
    if (!record.expanded) {
      record.bounds = bounds(
        0,
        nextY,
        record.size.width,
        record.size.height
      );
      layout.shapes.set(record.element, record.bounds);
      nextY += record.size.height + VERTICAL_GAP;
      continue;
    }

    const extents = getExtents(record.child);
    const size = sizeExpandedSubProcess(extents);

    record.bounds = bounds(0, nextY, size.width, size.height);
    layout.shapes.set(record.element, record.bounds);
    translateLayout(
      record.child,
      record.bounds.x + SUB_PROCESS_PADDING - extents.minX,
      record.bounds.y + SUB_PROCESS_PADDING - extents.minY
    );
    record.child.emitInParent = true;
    nextY += size.height + VERTICAL_GAP;
  }

  return context;
}
