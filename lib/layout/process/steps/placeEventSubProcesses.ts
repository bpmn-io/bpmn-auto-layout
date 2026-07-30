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

import type { LayoutRecord, ProcessLayoutContext } from '../../Types.js';
import type { BpmnElementFor } from '../../bpmn/Types.js';

type EventSubProcessRecord = LayoutRecord & {
  element: BpmnElementFor<'bpmn:SubProcess'>;
};

function isEventSubProcessRecord(record: LayoutRecord): record is EventSubProcessRecord {
  return is(record.element, 'bpmn:SubProcess') && !!record.element.triggeredByEvent;
}

function getRequired<Value>(value: Value | null): Value {
  if (value === null) {
    throw new Error('Expected event sub-process child layout');
  }

  return value;
}

export function placeEventSubProcesses(context: ProcessLayoutContext): ProcessLayoutContext {
  const { layout } = context;
  const { records } = context.placement;
  const eventSubProcesses = records.filter(isEventSubProcessRecord);
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

    const child = getRequired(record.child);
    const extents = getExtents(child);
    const size = sizeExpandedSubProcess(extents);

    record.bounds = bounds(0, nextY, size.width, size.height);
    layout.shapes.set(record.element, record.bounds);
    translateLayout(
      child,
      record.bounds.x + SUB_PROCESS_PADDING - extents.minX,
      record.bounds.y + SUB_PROCESS_PADDING - extents.minY
    );
    child.emitInParent = true;
    nextY += size.height + VERTICAL_GAP;
  }

  return context;
}
