import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import { edgePriority } from '../semantics/SemanticPolicy.js';
import {
  routeConnection
} from '../routing/SequenceFlowRouting.js';

import type {
  RoutingConstraints
} from '../routing/SequenceFlowRouting.js';
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

type BundleRoutingOptions = {
  constraints: Map<BpmnElement, RoutingConstraints>;
  bundle: Set<BpmnElement>;
  flows: BpmnElement[];
  layout: LayoutState;
  policy: ProcessLayoutContext['semantics']['policy'];
};
type RoutePlan = {
  children: LayoutState[];
  constraints: RoutingConstraints;
  constraintsByFlow: Map<BpmnElement, RoutingConstraints>;
  flows: BpmnElement[];
  initialEdges: Map<BpmnElement, Waypoint[]>;
  layoutShapes: Map<BpmnElement, Bounds>;
  policy: ProcessRoutingPolicy;
  selectedFlows?: Set<BpmnElement>;
};

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
  constraints = {},
  constraintsByFlow = new Map()
}: {
  shapes: Map<BpmnElement, Bounds>;
  children: LayoutState[];
  flows: BpmnElement[];
  policy: ProcessLayoutContext['semantics']['policy'];
  constraints?: RoutingConstraints;
  constraintsByFlow?: Map<BpmnElement, RoutingConstraints>;
}): Map<BpmnElement, Waypoint[]> {
  return executeRoutePlan({
    children,
    constraints,
    constraintsByFlow,
    flows,
    initialEdges: new Map(),
    layoutShapes,
    policy: getRoutingPolicy(semanticPolicy)
  });
}

export function rerouteSequenceFlowBundle({
  constraints,
  bundle,
  flows,
  layout,
  policy: semanticPolicy
}: BundleRoutingOptions): Map<BpmnElement, Waypoint[]> {
  return executeRoutePlan({
    children: layout.children,
    constraints: { adaptiveFeedbackSide: true },
    constraintsByFlow: constraints,
    flows,
    initialEdges: layout.edges,
    layoutShapes: layout.shapes,
    policy: getRoutingPolicy(semanticPolicy),
    selectedFlows: bundle
  });
}

function executeRoutePlan({
  children,
  constraints,
  constraintsByFlow,
  flows,
  initialEdges,
  layoutShapes,
  policy,
  selectedFlows
}: RoutePlan): Map<BpmnElement, Waypoint[]> {
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
  const routed = new Map(initialEdges);
  const routedConnections: Parameters<typeof routeConnection>[4] = [
    ...routed
  ]
    .filter((entry): entry is [ Parameters<typeof routeConnection>[0], Waypoint[] ] => {
      return !selectedFlows?.has(entry[0]) && isRoutableSequenceFlow(entry[0]);
    })
    .map(([ flow, points ]) => ({ flow, points }));
  const ordered = flows
    .filter((flow): flow is Parameters<typeof routeConnection>[0] => {
      return (!selectedFlows || selectedFlows.has(flow)) &&
        isRoutableSequenceFlow(flow);
    })
    .sort((a, b) => {
      return edgePriority(a, policy) - edgePriority(b, policy) ||
        getRequired(policy.edgeOrder.get(a)) - getRequired(policy.edgeOrder.get(b));
    });

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
      policy,
      mergeRoutingConstraints(constraints, constraintsByFlow.get(flow))
    );

    routed.set(flow, points);
    routedConnections.push({ flow, points });
  }

  return routed;
}

function mergeRoutingConstraints(
    defaults: RoutingConstraints,
    overrides: RoutingConstraints | undefined
): RoutingConstraints {
  return overrides
    ? { ...defaults, ...overrides }
    : defaults;
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
