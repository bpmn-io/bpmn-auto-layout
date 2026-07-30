import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import { getExpandedChildShapes } from '../../geometry/index.js';
import { edgePriority } from '../semantics/SemanticPolicy.js';
import { routeConnection } from '../routing/SequenceFlowRouting.js';

import type {
  ProcessLayoutContext,
  SemanticPolicy as LayoutSemanticPolicy
} from '../../Types.js';

type RoutingPolicy = Parameters<typeof routeConnection>[5];
type PriorityPolicy = NonNullable<Parameters<typeof edgePriority>[1]>;
type ProcessRoutingPolicy = RoutingPolicy & PriorityPolicy;

export function routeSequenceFlows(context: ProcessLayoutContext): ProcessLayoutContext {
  const { layout } = context;
  const { sequenceFlows } = context.elements;
  const policy = getRoutingPolicy(context.semantics.policy);
  const routedConnections: Parameters<typeof routeConnection>[4] = [];
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
  const ordered = sequenceFlows.filter(isRoutableSequenceFlow).sort((a, b) => {
    return edgePriority(a, policy) - edgePriority(b, policy) ||
      getRequired(policy.edgeOrder.get(a)) - getRequired(policy.edgeOrder.get(b));
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


function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected sequence flow routing value');
  }

  return value;
}

function getRoutingPolicy(
    policy: ProcessLayoutContext['semantics']['policy']
): LayoutSemanticPolicy & ProcessRoutingPolicy {
  if (!isRoutingPolicy(policy)) {
    throw new Error('Expected sequence flow routing policy');
  }

  return policy;
}

function isRoutingPolicy(
    policy: ProcessLayoutContext['semantics']['policy']
): policy is LayoutSemanticPolicy & ProcessRoutingPolicy {
  return policy !== null &&
    [
      ...policy.spine,
      ...policy.straightEdges,
      ...policy.graphEdges,
      ...policy.backEdges
    ].every(isRoutableSequenceFlow) &&
    [ ...policy.bands.keys() ].every(element => is(element, 'bpmn:FlowNode'));
}

function isRoutableSequenceFlow(
    element: ProcessLayoutContext['elements']['sequenceFlows'][number]
): element is Parameters<typeof routeConnection>[0] {
  return is(element, 'bpmn:SequenceFlow') &&
    is(element.sourceRef, 'bpmn:FlowNode') &&
    is(element.targetRef, 'bpmn:FlowNode');
}
