import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';
import { compareScores, getShapeExtents } from '../../geometry/index.js';
import {
  createFeedbackAlignmentCandidates,
  createFeedbackMirrorCandidate,
  flattenFeedbackRegions
} from '../optimization/FeedbackMoves.js';
import {
  introducesHardDefect,
  scorePlacementCandidate
} from '../optimization/LayoutScoring.js';
import {
  commitPlacementCandidate,
  createBaselineCandidate
} from '../optimization/PlacementCandidate.js';
import { routeSequenceFlowLayout } from './routeSequenceFlows.js';

import type {
  BpmnElement,
  FeedbackRegion,
  ProcessLayoutContext,
  SemanticPolicy
} from '../../Types.js';
import type { ModdleElement } from 'moddle';
import type {
  BpmnFlowNode,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';
import type {
  LayoutScore
} from '../optimization/LayoutScoring.js';
import type {
  PlacementCandidate
} from '../optimization/PlacementCandidate.js';

const MAX_MIRROR_PASSES = 2;
const MAX_ALIGNMENT_PASSES = 2;
const MAX_OPTIMIZER_CANDIDATES = 48;
const MAX_ROUTED_EDGE_EVALUATIONS = 1200;

type FlowNode = ModdleElement<BpmnFlowNode>;
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};

export function optimizeFlowNodeLayout(
    context: ProcessLayoutContext
): ProcessLayoutContext {
  const policy = context.semantics.policy;

  if (
    !policy?.feedbackRegions.length
  ) {
    return context;
  }

  const mirrorRegions = orderRegions(policy.feedbackRegions, context, policy);
  const regions = orderRegions(
    createAlignmentRegions(policy, context),
    context,
    policy
  );
  const routeBudget = Math.min(
    MAX_OPTIMIZER_CANDIDATES,
    Math.floor(
      MAX_ROUTED_EDGE_EVALUATIONS /
      Math.max(1, context.elements.sequenceFlows.length)
    )
  );

  if (!routeBudget) {
    return context;
  }

  const baseline = createBaselineCandidate(context.layout);
  const baselineScore = scorePlacementCandidate(baseline, policy);
  let current = baseline;
  let currentScore = baselineScore;
  let evaluated = 0;

  for (let pass = 0; pass < MAX_MIRROR_PASSES; pass++) {
    let improved = false;

    for (let index = 0; index < mirrorRegions.length; index++) {
      if (evaluated >= routeBudget) {
        break;
      }

      const candidate = createFeedbackMirrorCandidate(
        context,
        current,
        mirrorRegions[index],
        `${ current.moveKey }/feedback-${ index }-mirror`
      );

      if (!candidate || !routeCandidate(candidate, context, policy)) {
        continue;
      }

      evaluated++;
      const score = scorePlacementCandidate(candidate, policy);

      if (
        introducesHardDefect(score, baselineScore) ||
        score.spineLoadImbalance >= currentScore.spineLoadImbalance ||
        !isStrictImprovement(score, currentScore)
      ) {
        continue;
      }

      current = candidate;
      currentScore = score;
      improved = true;
    }

    if (!improved || evaluated >= routeBudget) {
      break;
    }
  }

  for (let pass = 0; pass < MAX_ALIGNMENT_PASSES; pass++) {
    let best = current;
    let bestScore = currentScore;
    const candidateGroups = regions.map((region, index) => {
      return createFeedbackAlignmentCandidates(
        context,
        current,
        region,
        `${ current.moveKey }/feedback-${ index }`
      );
    });
    const maximumGroupSize = Math.max(
      0,
      ...candidateGroups.map(candidates => candidates.length)
    );

    for (
      let candidateIndex = 0;
      candidateIndex < maximumGroupSize;
      candidateIndex++
    ) {
      if (evaluated >= routeBudget) {
        break;
      }

      for (const candidates of candidateGroups) {
        if (evaluated >= routeBudget) {
          break;
        }

        const candidate = candidates[candidateIndex];

        if (!candidate) {
          continue;
        }

        if (!routeCandidate(candidate, context, policy)) {
          continue;
        }

        evaluated++;
        const score = scorePlacementCandidate(candidate, policy);

        if (
          introducesHardDefect(score, baselineScore) ||
          !isStrictImprovement(score, bestScore)
        ) {
          continue;
        }

        best = candidate;
        bestScore = score;
      }
    }

    if (best === current) {
      break;
    }

    current = best;
    currentScore = bestScore;
  }

  if (
    current !== baseline &&
    !regressesRouteComplexity(currentScore, baselineScore)
  ) {
    commitPlacementCandidate(context.layout, current);
  }

  return context;
}

function createAlignmentRegions(
    policy: SemanticPolicy,
    context: ProcessLayoutContext
): FeedbackRegion[] {
  const roots = [ ...policy.feedbackRegions ];
  const covered = new Set(
    flattenFeedbackRegions(roots).flatMap(region => {
      return region.branches.flatMap(branch => [ ...branch.returnEdges ]);
    })
  );
  const graphEdges = context.elements.sequenceFlows
    .filter((element): element is FlowEdge => {
      return is(element, 'bpmn:SequenceFlow') &&
        !!element.sourceRef &&
        !!element.targetRef;
    });

  const returnEdges = graphEdges.filter(edge => {
    const source = context.layout.shapes.get(edge.sourceRef);
    const target = context.layout.shapes.get(edge.targetRef);

    return policy.backEdges.has(edge) ||
      !!source && !!target && target.x < source.x;
  });

  for (const element of returnEdges) {
    if (
      covered.has(element) ||
      !is(element, 'bpmn:SequenceFlow') ||
      !element.sourceRef ||
      !element.targetRef
    ) {
      continue;
    }

    const edge = element as FlowEdge;
    const nodes = findReturnBranchNodes(edge, graphEdges);

    if (!nodes.size) {
      continue;
    }

    roots.push({
      split: edge.targetRef,
      branches: [ {
        entry: firstBranchNode(edge.targetRef, nodes, graphEdges) ||
          edge.sourceRef,
        nodes,
        returnEdges: new Set<BpmnElement>([ edge ]),
        maximumReturnDepth: 0
      } ],
      children: []
    });
  }

  return roots;
}

function findReturnBranchNodes(
    returnEdge: FlowEdge,
    graphEdges: FlowEdge[]
): Set<BpmnElement> {
  const forward = reachableNodes(
    returnEdge.targetRef,
    graphEdges,
    returnEdge,
    false
  );
  const backward = reachableNodes(
    returnEdge.sourceRef,
    graphEdges,
    returnEdge,
    true
  );

  if (!forward.has(returnEdge.sourceRef)) {
    return new Set();
  }

  return new Set([ ...forward ].filter(node => {
    return node !== returnEdge.targetRef && backward.has(node);
  }));
}

function reachableNodes(
    start: FlowNode,
    graphEdges: FlowEdge[],
    excluded: FlowEdge,
    reverse: boolean
): Set<FlowNode> {
  const visited = new Set<FlowNode>([ start ]);
  const pending = [ start ];

  while (pending.length) {
    const current = pending.shift() as FlowNode;

    for (const edge of graphEdges) {
      if (edge === excluded) {
        continue;
      }

      const matches = reverse
        ? edge.targetRef === current
        : edge.sourceRef === current;

      if (!matches) {
        continue;
      }

      const next = reverse ? edge.sourceRef : edge.targetRef;

      if (!visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }

  return visited;
}

function firstBranchNode(
    split: FlowNode,
    nodes: Set<BpmnElement>,
    graphEdges: FlowEdge[]
): BpmnElement | null {
  return graphEdges.find(edge => {
    return edge.sourceRef === split && nodes.has(edge.targetRef);
  })?.targetRef || null;
}

function routeCandidate(
    candidate: PlacementCandidate,
    context: ProcessLayoutContext,
    policy: SemanticPolicy
): boolean {
  try {
    candidate.layout.edges = routeSequenceFlowLayout({
      shapes: candidate.layout.shapes,
      children: candidate.layout.children,
      flows: context.elements.sequenceFlows,
      policy,
      adaptiveFeedbackSide: true
    });

    return true;
  } catch (error) {
    if (error instanceof LayoutError && error.code === 'ROUTING_FAILED') {
      return false;
    }

    throw error;
  }
}

function isStrictImprovement(
    candidate: LayoutScore,
    current: LayoutScore
): boolean {
  return compareScores(candidate.vector, current.vector) < 0;
}

function regressesRouteComplexity(
    candidate: LayoutScore,
    baseline: LayoutScore
): boolean {
  return candidate.bends > baseline.bends ||
    candidate.length > baseline.length;
}

function orderRegions(
    roots: FeedbackRegion[],
    context: ProcessLayoutContext,
    policy: SemanticPolicy
): FeedbackRegion[] {
  return flattenFeedbackRegions(roots).sort((a, b) => {
    return regionArea(b, context) - regionArea(a, context) ||
      requiredDocumentIndex(policy, a) - requiredDocumentIndex(policy, b);
  });
}

function regionArea(
    region: FeedbackRegion,
    context: ProcessLayoutContext
): number {
  const shapes = region.branches.flatMap(branch => {
    return [ ...branch.nodes ]
      .map(element => context.layout.shapes.get(element))
      .filter((rect): rect is NonNullable<typeof rect> => !!rect)
      .map(rect => ({ rect }));
  });
  const extents = getShapeExtents(shapes);

  return extents.width * extents.height;
}

function requiredDocumentIndex(
    policy: SemanticPolicy,
    region: FeedbackRegion
): number {
  const index = policy.flowNodeDocumentIndex.get(region.split);

  if (index === undefined) {
    throw new Error('Expected feedback region document index');
  }

  return index;
}
