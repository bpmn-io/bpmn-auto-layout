import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';
import { compareScores, getShapeExtents } from '../../geometry/index.js';
import {
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
  FeedbackRegion,
  ProcessLayoutContext,
  SemanticPolicy
} from '../../Types.js';
import type {
  LayoutScore
} from '../optimization/LayoutScoring.js';
import type {
  PlacementCandidate
} from '../optimization/PlacementCandidate.js';

const MAX_OPTIMIZER_PASSES = 2;
const MAX_OPTIMIZER_CANDIDATES = 32;
const MAX_ROUTED_EDGE_EVALUATIONS = 1200;

export function optimizeFlowNodeLayout(
    context: ProcessLayoutContext
): ProcessLayoutContext {
  const policy = context.semantics.policy;

  if (
    !policy?.feedbackRegions.length ||
    context.placement.records.some(record => record.isArtifact) ||
    ![ ...context.layout.shapes.keys() ].some(element => {
      return is(element, 'bpmn:BoundaryEvent');
    })
  ) {
    return context;
  }

  const regions = orderRegions(policy.feedbackRegions, context, policy);
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

  for (let pass = 0; pass < MAX_OPTIMIZER_PASSES; pass++) {
    let improved = false;

    for (let index = 0; index < regions.length; index++) {
      if (evaluated >= routeBudget) {
        break;
      }

      const candidate = createFeedbackMirrorCandidate(
        context,
        current,
        regions[index],
        `${ current.moveKey }/feedback-${ index }-mirror`
      );

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

  if (current !== baseline) {
    commitPlacementCandidate(context.layout, current);
  }

  return context;
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
