import {
  compareScores,
  segmentsProperlyCross,
  toSegments
} from '../../geometry/index.js';
import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';
import {
  finalizeLayoutConnections
} from '../../connections/FinalizeConnections.js';
import {
  scoreCompleteLayout
} from '../../process/optimization/LayoutScoring.js';
import {
  cloneLayout
} from '../../process/optimization/PlacementCandidate.js';
import {
  collectPrimaryEdgeOptions
} from '../../process/steps/optimizePrimaryPaths.js';
import {
  rerouteSequenceFlowBundle
} from '../../process/steps/routeSequenceFlows.js';

import type {
  BpmnElement,
  CollaborationLayoutContext,
  LayoutState,
  ProcessLayoutResult,
  Waypoint
} from '../../Types.js';
import type {
  CompleteLayoutScore
} from '../../process/optimization/LayoutScoring.js';
import type {
  PrimaryEdgeOptions
} from '../../process/steps/optimizePrimaryPaths.js';
import type {
  RoutingConstraints
} from '../../process/routing/SequenceFlowRouting.js';

const MAX_COLLABORATION_CANDIDATES = 32;
const MAX_ADDITIONAL_BENDS = 4;
const MAX_BEND_GROWTH = 0.1;
const MAX_CONTAINER_FOOTPRINT_GROWTH = 1.1;
const MAX_PROCESS_PARTICIPANTS = 4;
const MIN_COLLABORATION_DECISIONS = 3;
const MAX_CROSSINGS_FOR_BEND_TRADE = 1;
const MIN_BEND_SAVINGS_PER_CROSSING = 3;

type EvaluatedCandidate = {
  result: ProcessLayoutResult;
  score: CompleteLayoutScore;
};

type RoutedEdge = {
  flow: BpmnElement;
  layout: LayoutState;
  points: Waypoint[];
};

type CrossingPair = {
  contacts: Waypoint[];
  edges: [ RoutedEdge, RoutedEdge ];
};

export function optimizeCollaborationLayout(
    context: CollaborationLayoutContext
): CollaborationLayoutContext {
  if (
    context.participants.semantics.size < 2 ||
    context.participants.semantics.size > MAX_PROCESS_PARTICIPANTS
  ) {
    return context;
  }

  const decisions = [ ...context.participants.semantics.values() ]
    .flatMap(semantics => {
      return semantics.policy ? collectPrimaryEdgeOptions(semantics.policy) : [];
    })
    .sort(compareDecisions)
    .slice(0, 5);

  if (decisions.length < MIN_COLLABORATION_DECISIONS) {
    return context;
  }

  const baselineScore = scoreFinalizedLayout(context.layout);
  let best: EvaluatedCandidate | null = null;
  let evaluated = 0;

  for (const overrides of enumerateOverrides(decisions)) {
    if (evaluated >= MAX_COLLABORATION_CANDIDATES) {
      break;
    }

    const result = context.options.layoutCollaboration(context.collaboration, {
      expandedIds: context.options.expandedIds,
      optimizeCollaboration: false,
      optimizePrimaryPaths: false,
      primaryEdgeOverrides: overrides
    });
    const repaired = repairFinalizationCrossings(
      result.layout,
      context.participants.semantics
    );

    evaluated++;

    if (
      !repaired ||
      introducesHardDefect(repaired.score, baselineScore) ||
      !isBetterCandidate(repaired.score, best?.score || baselineScore)
    ) {
      continue;
    }

    best = {
      result: {
        ...result,
        layout: repaired.layout
      },
      score: repaired.score
    };
  }

  if (!best) {
    return context;
  }

  return {
    ...context,
    layout: best.result.layout,
    primaryPathDiagnostics: best.result.primaryPathDiagnostics,
    warnings: best.result.warnings
  };
}

function scoreFinalizedLayout(
    layout: CollaborationLayoutContext['layout']
): CompleteLayoutScore {
  const finalized = cloneLayout(layout);

  finalizeLayoutConnections(finalized, true);

  return scoreCompleteLayout(finalized);
}

function repairFinalizationCrossings(
    layout: LayoutState,
    semantics: CollaborationLayoutContext['participants']['semantics']
): { layout: LayoutState; score: CompleteLayoutScore } | null {
  const finalized = cloneLayout(layout);

  finalizeLayoutConnections(finalized, true);

  const flow = findFinalizationCrossingRepairFlow(layout, finalized);
  const originalScore = scoreCompleteLayout(finalized);

  if (!flow) {
    return {
      layout,
      score: originalScore
    };
  }

  const repaired = rerouteFinalizationCrossing(layout, flow, semantics);

  return repaired && compareScores(repaired.score.vector, originalScore.vector) < 0
    ? repaired
    : {
      layout,
      score: originalScore
    };
}

function rerouteFinalizationCrossing(
    layout: LayoutState,
    flow: BpmnElement,
    semantics: CollaborationLayoutContext['participants']['semantics']
): { layout: LayoutState; score: CompleteLayoutScore } | null {
  const repaired = cloneLayout(layout);
  const routed = collectRoutedEdges(repaired);
  const edge = routed.get(flow);
  const policy = findPolicy(flow, semantics);

  if (!edge || !policy) {
    return null;
  }

  try {
    edge.layout.edges = rerouteSequenceFlowBundle({
      constraints: new Map<BpmnElement, RoutingConstraints>([
        [ flow, {
          dockAssignment: {
            source: 'south',
            target: 'south'
          },
          localUChannel: 'south'
        } ]
      ]),
      bundle: new Set([ flow ]),
      flows: policy.graphEdges,
      layout: edge.layout,
      policy
    });
  } catch (error) {
    if (error instanceof LayoutError) {
      return null;
    }

    throw error;
  }

  const repairedFinalized = cloneLayout(repaired);

  finalizeLayoutConnections(repairedFinalized, true);

  return {
    layout: repaired,
    score: scoreCompleteLayout(repairedFinalized)
  };
}

function findFinalizationCrossingRepairFlow(
    raw: LayoutState,
    finalized: LayoutState
): BpmnElement | null {
  const rawEdges = collectRoutedEdges(raw);
  const rawCrossings = crossingPairs(rawEdges);
  const finalizedCrossings = crossingPairs(collectRoutedEdges(finalized));
  const candidates = new Set<BpmnElement>();

  for (const [ key, finalizedPair ] of finalizedCrossings) {
    const rawPair = rawCrossings.get(key);

    for (const contact of finalizedPair.contacts) {
      if (rawPair?.contacts.some(point => samePoint(point, contact))) {
        continue;
      }

      for (const edge of finalizedPair.edges) {
        const rawEdge = rawEdges.get(edge.flow);

        if (
          is(edge.flow, 'bpmn:SequenceFlow') &&
          rawEdge &&
          hasRemovedCollinearWaypointAt(rawEdge.points, edge.points, contact)
        ) {
          candidates.add(edge.flow);
        }
      }
    }
  }

  return candidates.size === 1 ? candidates.values().next().value || null : null;
}

function crossingPairs(
    edges: Map<BpmnElement, RoutedEdge>
): Map<string, CrossingPair> {
  const pairs = new Map<string, CrossingPair>();
  const entries = [ ...edges.values() ];

  for (let left = 0; left < entries.length; left++) {
    for (let right = left + 1; right < entries.length; right++) {
      const a = entries[left];
      const b = entries[right];

      const contacts = routeCrossings(a.points, b.points);

      if (!contacts.length) {
        continue;
      }

      pairs.set(pairKey(a.flow, b.flow), {
        contacts,
        edges: [ a, b ]
      });
    }
  }

  return pairs;
}

function routeCrossings(
    a: RoutedEdge['points'],
    b: RoutedEdge['points']
): Waypoint[] {
  const crossings: Waypoint[] = [];

  for (const [ start, end ] of toSegments(a)) {
    for (const [ otherStart, otherEnd ] of toSegments(b)) {
      if (!segmentsProperlyCross(start, end, otherStart, otherEnd)) {
        continue;
      }

      const contact = routeCrossingPoint(start, end, otherStart, otherEnd);

      if (contact) {
        crossings.push(contact);
      }
    }
  }

  return crossings;
}

function routeCrossingPoint(
    start: Waypoint,
    end: Waypoint,
    otherStart: Waypoint,
    otherEnd: Waypoint
): Waypoint | null {
  if (start.x === end.x && otherStart.y === otherEnd.y) {
    return { x: start.x, y: otherStart.y };
  }

  if (start.y === end.y && otherStart.x === otherEnd.x) {
    return { x: otherStart.x, y: start.y };
  }

  return null;
}

function hasRemovedCollinearWaypointAt(
    raw: Waypoint[],
    finalized: Waypoint[],
    contact: Waypoint
): boolean {
  if (finalized.some(point => samePoint(point, contact))) {
    return false;
  }

  return raw.some((point, index) => {
    const previous = raw[index - 1];
    const next = raw[index + 1];

    return !!previous &&
      !!next &&
      samePoint(point, contact) &&
      collinear(previous, point, next);
  });
}

function samePoint(a: Waypoint, b: Waypoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function collinear(
    previous: Waypoint,
    point: Waypoint,
    next: Waypoint
): boolean {
  return (previous.x - point.x) * (next.y - point.y) ===
    (previous.y - point.y) * (next.x - point.x);
}

function pairKey(a: BpmnElement, b: BpmnElement): string {
  const [ first, second ] = [ a, b ].sort((left, right) => {
    return (left.id || '').localeCompare(right.id || '');
  });

  return `${ first.id || '' }\u0000${ second.id || '' }`;
}

function collectRoutedEdges(
    layout: LayoutState,
    edges = new Map<BpmnElement, RoutedEdge>()
): Map<BpmnElement, RoutedEdge> {
  for (const [ flow, points ] of layout.edges) {
    edges.set(flow, { flow, layout, points });
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      collectRoutedEdges(child, edges);
    }
  }

  return edges;
}

function findPolicy(
    flow: BpmnElement,
    semantics: CollaborationLayoutContext['participants']['semantics']
) {
  return [ ...semantics.values() ]
    .map(({ policy }) => policy)
    .find(policy => policy?.graphEdges.includes(flow)) || null;
}

function isBetterCandidate(
    candidate: CompleteLayoutScore,
    current: CompleteLayoutScore
): boolean {
  if (
    candidate.containerFootprint >
    current.containerFootprint * MAX_CONTAINER_FOOTPRINT_GROWTH
  ) {
    return false;
  }

  if (
    candidate.bends >
    current.bends + Math.max(
      MAX_ADDITIONAL_BENDS,
      current.bends * MAX_BEND_GROWTH
    )
  ) {
    return false;
  }

  if (isBoundedBendTrade(candidate, current)) {
    return true;
  }

  return compareScores(
    candidate.vector.slice(0, -1),
    current.vector.slice(0, -1)
  ) < 0;
}

function isBoundedBendTrade(
    candidate: CompleteLayoutScore,
    current: CompleteLayoutScore
): boolean {
  const crossingsAdded = candidate.crossings - current.crossings;
  const bendSavings = current.bends - candidate.bends;

  return crossingsAdded > 0 &&
    crossingsAdded <= MAX_CROSSINGS_FOR_BEND_TRADE &&
    bendSavings >= crossingsAdded * MIN_BEND_SAVINGS_PER_CROSSING &&
    candidate.containerFootprint <= current.containerFootprint &&
    candidate.footprint <= current.footprint &&
    candidate.length <= current.length;
}

function enumerateOverrides(
    decisions: PrimaryEdgeOptions[]
): Map<BpmnElement, BpmnElement>[] {
  let choices: Map<BpmnElement, BpmnElement>[] = [ new Map() ];

  for (const decision of decisions) {
    choices = choices.flatMap(choice => {
      return decision.candidates.map(candidate => {
        const next = new Map(choice);

        next.set(decision.source, candidate);
        return next;
      });
    });
  }

  return choices;
}

function introducesHardDefect(
    candidate: CompleteLayoutScore,
    baseline: CompleteLayoutScore
): boolean {
  return candidate.hardDefects.some((value, index) => {
    return value > baseline.hardDefects[index];
  });
}

function compareDecisions(
    a: PrimaryEdgeOptions,
    b: PrimaryEdgeOptions
): number {
  return (a.source.id || '').localeCompare(b.source.id || '');
}
