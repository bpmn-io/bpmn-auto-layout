import { is } from '../../../di/DiUtil.js';
import { getExtents } from '../../geometry/index.js';
import { createProcessLayoutContext } from '../Context.js';
import { runProcessPipeline } from '../Pipeline.js';
import { sizeExpandedSubProcess } from '../placement/ExpandedSubProcess.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function layoutChildScopes(context) {
  const { layout, warnings } = context;
  const { records } = context.placement;
  const {
    expandedIds,
    messageFlowEndpointDirections,
    steps
  } = context.options;

  for (const record of records) {
    if (!is(record.element, 'bpmn:SubProcess')) {
      continue;
    }

    const childContext = runProcessPipeline(createProcessLayoutContext(
      record.element,
      {
        expandedIds,
        messageFlowEndpointDirections,
        steps
      }
    ));

    record.child = childContext.layout;
    warnings.push(...childContext.warnings);

    if (record.expanded) {
      record.size = sizeExpandedSubProcess(getExtents(record.child));
    }

    layout.children.push(record.child);
  }

  return context;
}
