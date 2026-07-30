import { is } from '../../../di/DiUtil.js';
import { getExtents } from '../../geometry/index.js';
import { sizeExpandedSubProcess } from '../placement/ExpandedSubProcess.js';

import type { ProcessLayoutContext } from '../../Types.js';

export function layoutChildScopes(context: ProcessLayoutContext): ProcessLayoutContext {
  const { layout, warnings } = context;
  const { records } = context.placement;
  const {
    expandedIds,
    layoutScope,
    messageFlowEndpointDirections,
  } = context.options;

  for (const record of records) {
    if (!is(record.element, 'bpmn:SubProcess')) {
      continue;
    }

    const childResult = layoutScope(
      record.element,
      {
        expandedIds,
        messageFlowEndpointDirections
      }
    );

    record.child = childResult.layout;
    warnings.push(...childResult.warnings);

    if (record.expanded) {
      record.size = sizeExpandedSubProcess(getExtents(record.child));
    }

    layout.children.push(record.child);
  }

  return context;
}
