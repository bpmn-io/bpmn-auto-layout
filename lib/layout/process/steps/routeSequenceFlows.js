import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import { getExpandedChildShapes } from '../../geometry/index.js';
import { edgePriority } from '../semantics/SemanticPolicy.js';
import { routeConnection } from '../routing/SequenceFlowRouting.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function routeSequenceFlows(context) {
  const { layout } = context;
  const { sequenceFlows } = context.elements;
  const { policy } = context.semantics;
  const routedConnections = [];
  const shapes = [
    ...layout.shapes.entries(),
    ...getExpandedChildShapes(layout)
  ]
    .filter(([ element ]) => {
      return !is(element, 'bpmn:Lane') &&
        !is(element, 'bpmn:Participant') &&
        !isArtifact(element);
    })
    .map(([ element, rect ]) => ({ element, rect }));
  const ordered = [ ...sequenceFlows ].sort((a, b) => {
    return edgePriority(a, policy) - edgePriority(b, policy) ||
      policy.edgeOrder.get(a) - policy.edgeOrder.get(b);
  });

  for (const flow of ordered) {
    const source = layout.shapes.get(flow.sourceRef);
    const target = layout.shapes.get(flow.targetRef);

    if (!source || !target) {
      continue;
    }

    const points = routeConnection(
      flow,
      source,
      target,
      shapes,
      routedConnections,
      policy
    );

    layout.edges.set(flow, points);
    routedConnections.push({ flow, points });
  }

  return context;
}
