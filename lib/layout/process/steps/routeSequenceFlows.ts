import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import { edgePriority } from '../semantics/SemanticPolicy.js';
import { routeConnection } from '../routing/SequenceFlowRouting.js';

import type {
  BpmnElement,
  Bounds,
  LayoutState,
  ProcessLayoutContext,
  SemanticPolicy as LayoutSemanticPolicy,
  Waypoint
} from '../../Types.js';

type RoutingPolicy = Parameters<typeof routeConnection>[5];
type PriorityPolicy = NonNullable<Parameters<typeof edgePriority>[1]>;
type ProcessRoutingPolicy = RoutingPolicy & PriorityPolicy;

export function routeSequenceFlows(context: ProcessLayoutContext): ProcessLayoutContext {
  const { layout } = context;
  const routed = routeSequenceFlowLayout({
    shapes: layout.shapes,
    children: layout.children,
    flows: context.elements.sequenceFlows,
    policy: context.semantics.policy
  });

  layout.edges.clear();

  for (const [ flow, points ] of routed) {
    layout.edges.set(flow, points);
  }

  return context;
}

export function routeSequenceFlowLayout({
  shapes: layoutShapes,
  children,
  flows,
  policy: semanticPolicy,
  adaptiveFeedbackSide = false
}: {
  shapes: Map<BpmnElement, Bounds>;
  children: LayoutState[];
  flows: BpmnElement[];
  policy: ProcessLayoutContext['semantics']['policy'];
  adaptiveFeedbackSide?: boolean;
}): Map<BpmnElement, Waypoint[]> {
  const basePolicy = getRoutingPolicy(semanticPolicy);
  const policy = adaptiveFeedbackSide
    ? { ...basePolicy, adaptiveFeedbackSide: true }
    : basePolicy;
  const routedConnections: Parameters<typeof routeConnection>[4] = [];
  const shapes = [
    ...layoutShapes.entries(),
    ...getEmittedChildShapes(children)
  ]
    .filter(([ element ]) => {
      return !is(element, 'bpmn:Lane') &&
        !is(element, 'bpmn:Participant') &&
        !isArtifact(element);
    })
    .map(([ element, rect ]) => ({ element, rect }));
  const ordered = flows.filter(isRoutableSequenceFlow).sort((a, b) => {
    return edgePriority(a, policy) - edgePriority(b, policy) ||
      getRequired(policy.edgeOrder.get(a)) - getRequired(policy.edgeOrder.get(b));
  });
  const routed = new Map<BpmnElement, Waypoint[]>();

  for (const flow of ordered) {
    const source = layoutShapes.get(flow.sourceRef);
    const target = layoutShapes.get(flow.targetRef);

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

    routed.set(flow, points);
    routedConnections.push({ flow, points });
  }

  return routed;
}

function getEmittedChildShapes(
    children: LayoutState[]
): Array<[ BpmnElement, Bounds ]> {
  const shapes: Array<[ BpmnElement, Bounds ]> = [];

  for (const child of children) {
    if (!child.emitInParent) {
      continue;
    }

    shapes.push(...child.shapes.entries());
    shapes.push(...getEmittedChildShapes(child.children));
  }

  return shapes;
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
