import { is } from '../../../di/DiUtil.js';
import { compareScores } from '../../geometry/index.js';
import {
  introducesHardDefect,
  scorePlacementCandidate
} from '../optimization/LayoutScoring.js';
import {
  commitPlacementCandidate,
  createBaselineCandidate
} from '../optimization/PlacementCandidate.js';
import type {
  BpmnElement,
  ProcessLayoutContext,
  SemanticPolicy
} from '../../Types.js';
import type { ModdleElement } from 'moddle';
import type {
  BpmnFlowNode,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';
import type { PlacementCandidate } from '../optimization/PlacementCandidate.js';
import type { LayoutScore } from '../optimization/LayoutScoring.js';

const MAX_PRIMARY_PATH_CANDIDATES = 16;
const MAX_FOOTPRINT_GROWTH = 1.1;

type FlowNode = ModdleElement<BpmnFlowNode>;
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};
type PrimaryPathDecision = {
  candidates: FlowEdge[];
  current: FlowEdge | null;
  gateway: FlowNode;
};

export type PrimaryEdgeOptions = {
  candidates: BpmnElement[];
  source: BpmnElement;
};
type EvaluatedCandidate = {
  candidate: PlacementCandidate;
  policy: SemanticPolicy;
  ranks: NonNullable<ProcessLayoutContext['semantics']['ranks']>;
  score: LayoutScore;
};

export function optimizePrimaryPaths(
    context: ProcessLayoutContext
): ProcessLayoutContext {
  const policy = context.semantics.policy;
  const ranks = context.semantics.ranks;

  if (!policy || !ranks) {
    return context;
  }

  const baseline = createBaselineCandidate(context.layout);
  const baselineScore = scorePlacementCandidate(baseline, policy);
  let current: EvaluatedCandidate = {
    candidate: baseline,
    policy,
    ranks,
    score: baselineScore
  };
  const overrides = new Map(context.options.primaryEdgeOverrides);
  let evaluated = 0;

  for (const decision of collectPrimaryPathDecisions(policy)) {
    if (evaluated >= MAX_PRIMARY_PATH_CANDIDATES) {
      break;
    }

    let best = current;

    for (const edge of decision.candidates) {
      if (
        edge === decision.current ||
        evaluated >= MAX_PRIMARY_PATH_CANDIDATES
      ) {
        continue;
      }

      const candidate = evaluatePrimaryPathCandidate(
        context,
        overrides,
        decision.gateway,
        edge
      );

      if (!candidate) {
        continue;
      }

      evaluated++;

      if (introducesHardDefect(candidate.score, baselineScore)) {
        context.options.primaryPathDiagnostics.push({
          gatewayId: decision.gateway.id,
          edgeId: edge.id,
          score: candidate.score.vector,
          status: 'rejected-hard-defect'
        });
        continue;
      }

      if (!isBetterCandidate(candidate, best)) {
        context.options.primaryPathDiagnostics.push({
          gatewayId: decision.gateway.id,
          edgeId: edge.id,
          score: candidate.score.vector,
          status: 'rejected-quality'
        });
        continue;
      }

      context.options.primaryPathDiagnostics.push({
        gatewayId: decision.gateway.id,
        edgeId: edge.id,
        score: candidate.score.vector,
        status: 'accepted'
      });
      best = candidate;
    }

    if (best === current) {
      continue;
    }

    const selected = selectedPrimaryEdge(best.policy, decision.gateway);

    if (selected) {
      overrides.set(decision.gateway, selected);
    }

    current = best;
  }

  if (current.candidate !== baseline) {
    commitPlacementCandidate(context.layout, current.candidate);

    return {
      ...context,
      semantics: {
        policy: current.policy,
        ranks: current.ranks
      }
    };
  }

  return context;
}

export function collectPrimaryEdgeOptions(
    policy: SemanticPolicy
): PrimaryEdgeOptions[] {
  return collectPrimaryPathDecisions(policy, true, true).map((decision) => ({
    candidates: [ ...decision.candidates ].sort((a, b) => {
      return (a.id || '').localeCompare(b.id || '');
    }),
    source: decision.gateway
  }));
}

function collectPrimaryPathDecisions(
    policy: SemanticPolicy,
    includeReconverging = false,
    includeUnselected = false
): PrimaryPathDecision[] {
  const outgoing = new Map<FlowNode, FlowEdge[]>();

  for (const element of policy.graphEdges) {
    if (!isFlowEdge(element)) {
      continue;
    }

    if (!outgoing.has(element.sourceRef)) {
      outgoing.set(element.sourceRef, []);
    }

    getRequired(outgoing.get(element.sourceRef)).push(element);
  }

  const decisions: PrimaryPathDecision[] = [];

  for (const [ gateway, candidates ] of outgoing) {
    const current = selectedPrimaryEdge(policy, gateway);

    if (
      !isEligibleGateway(gateway, candidates, outgoing) ||
      candidates.length < 2 ||
      !current && !includeUnselected
    ) {
      continue;
    }

    function isEligibleGateway(
        gateway: FlowNode,
        candidates: FlowEdge[],
        outgoing: Map<FlowNode, FlowEdge[]>
    ): boolean {
      return (
        is(gateway, 'bpmn:InclusiveGateway') ||
        includeReconverging &&
        (
          is(gateway, 'bpmn:Gateway') ||
          hasReconvergingAlternatives(candidates, outgoing)
        )
      );
    }

    function hasReconvergingAlternatives(
        candidates: FlowEdge[],
        outgoing: Map<FlowNode, FlowEdge[]>
    ): boolean {
      const reachable = candidates.map((candidate) => {
        return reachableNodes(candidate.targetRef, outgoing);
      });

      const [ first, ...rest ] = reachable;

      return !!first && [ ...first ].some(node => {
        return rest.every(nodes => nodes.has(node));
      });
    }

    function reachableNodes(
        start: FlowNode,
        outgoing: Map<FlowNode, FlowEdge[]>
    ): Set<FlowNode> {
      const visited = new Set<FlowNode>();
      const pending = [ start ];

      while (pending.length) {
        const node = pending.shift();

        if (!node || visited.has(node)) {
          continue;
        }

        visited.add(node);

        for (const edge of outgoing.get(node) || []) {
          pending.push(edge.targetRef);
        }
      }

      return visited;
    }

    decisions.push({
      gateway,
      current,
      candidates: [ ...candidates ].sort((a, b) => {
        return (policy.edgeOrder.get(a) ?? 0) - (policy.edgeOrder.get(b) ?? 0);
      })
    });
  }

  return decisions.sort((a, b) => {
    return (
      (policy.flowNodeDocumentIndex.get(a.gateway) ?? 0) -
      (policy.flowNodeDocumentIndex.get(b.gateway) ?? 0)
    );
  });
}

function evaluatePrimaryPathCandidate(
    context: ProcessLayoutContext,
    overrides: Map<BpmnElement, BpmnElement>,
    gateway: FlowNode,
    edge: FlowEdge
): EvaluatedCandidate | null {
  const primaryEdgeOverrides = new Map(overrides);

  primaryEdgeOverrides.set(gateway, edge);

  const result = context.options.layoutScope(context.scope, {
    expandedIds: context.options.expandedIds,
    participantProcess: context.options.participantProcess,
    messageFlowEndpointDirections:
      context.options.messageFlowEndpointDirections,
    optimizePrimaryPaths: false,
    primaryEdgeOverrides
  });
  const policy = result.semantics.policy;
  const ranks = result.semantics.ranks;

  if (!policy || !ranks) {
    return null;
  }

  const candidate: PlacementCandidate = {
    layout: result.layout,
    moveKey: `primary-${gateway.id}-${edge.id}`,
    displacement: 0
  };
  return {
    candidate,
    policy,
    ranks,
    score: scorePlacementCandidate(candidate, policy)
  };
}

function isBetterCandidate(
    candidate: EvaluatedCandidate,
    current: EvaluatedCandidate
): boolean {
  if (
    candidate.score.footprint >
    current.score.footprint * MAX_FOOTPRINT_GROWTH
  ) {
    return false;
  }

  const visualDefectComparison = compareScores(
    candidate.score.vector.slice(0, 7),
    current.score.vector.slice(0, 7)
  );

  if (
    visualDefectComparison === 0 &&
    candidate.score.footprint >= current.score.footprint
  ) {
    return false;
  }

  return compareScores(candidate.score.vector, current.score.vector) < 0;
}

function selectedPrimaryEdge(
    policy: SemanticPolicy,
    gateway: FlowNode
): FlowEdge | null {
  for (const edge of policy.spine) {
    if (isFlowEdge(edge) && edge.sourceRef === gateway) {
      return edge;
    }
  }

  return null;
}

function isFlowEdge(element: BpmnElement): element is FlowEdge {
  return (
    is(element, 'bpmn:SequenceFlow') &&
    is(element.sourceRef, 'bpmn:FlowNode') &&
    is(element.targetRef, 'bpmn:FlowNode')
  );
}

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected primary-path candidate value');
  }

  return value;
}
