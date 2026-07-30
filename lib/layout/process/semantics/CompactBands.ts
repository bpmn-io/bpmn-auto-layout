import type { ModdleElement } from 'moddle';

import type {
  LayoutRecord,
  RankAssignment as LayoutRankAssignment,
  SemanticPolicy as LayoutSemanticPolicy
} from '../../Types.js';
import type { BpmnFlowNode, BpmnSequenceFlow } from '../../../moddle-types/bpmn.js';

type FlowNode = ModdleElement<BpmnFlowNode>;
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};
type BoundaryEdge = FlowEdge & {
  sourceRef: FlowNode & {
    attachedToRef: FlowNode;
  };
};
type FlowRecord = LayoutRecord & {
  element: FlowNode;
};
type SemanticPolicy = Omit<LayoutSemanticPolicy,
  'bands' | 'components' | 'backEdges' | 'boundaryBayEdges'
> & {
  bands: Map<FlowNode, number>;
  components: Map<FlowNode, number>;
  backEdges: Set<FlowEdge>;
  boundaryBayEdges: Set<FlowEdge>;
};
type RankAssignment = Omit<LayoutRankAssignment, 'rank'> & {
  rank: Map<FlowNode, number>;
};
type BandInterval = {
  component: number;
  band: number;
  boundary: boolean;
  spans: Array<{
    min: number;
    max: number;
  }>;
};
type BandIntervals = Map<string, BandInterval>;
type BandMapping = Map<string, number>;
type BoundaryHostBands = Map<string, number[]>;
type AssignedIntervals = Map<string, BandInterval[]>;

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected semantic layout value');
  }

  return value;
}

export function compactSemanticBands(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    ranks: RankAssignment,
    policy: SemanticPolicy
): void {
  const intervals = collectBandIntervals(
    records,
    graphEdges,
    boundaryEdges,
    ranks,
    policy
  );
  const boundaryHosts = collectBoundaryHostBands(boundaryEdges, policy);
  const mapping = assignCompactedBands(intervals, boundaryHosts);

  applyCompactedBands(records, policy, mapping);
}

function collectBandIntervals(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    ranks: RankAssignment,
    policy: SemanticPolicy
): BandIntervals {
  const intervals: BandIntervals = new Map();
  const outgoingCount = new Map<FlowNode, number>();

  for (const record of records) {
    outgoingCount.set(record.element, 0);
  }

  for (const edge of graphEdges) {
    outgoingCount.set(
      edge.sourceRef,
      (outgoingCount.get(edge.sourceRef) ?? 0) + 1
    );
  }

  for (const record of records) {
    const element = record.element;
    const rank = getRequired(ranks.rank.get(element));

    addBandInterval(
      intervals,
      getRequired(policy.components.get(element)),
      policy.bands.get(element) || 0,
      rank,
      rank
    );
  }

  for (const edge of graphEdges) {
    if (policy.backEdges.has(edge)) {
      continue;
    }

    const sourceRank = getRequired(ranks.rank.get(edge.sourceRef));
    const targetRank = getRequired(ranks.rank.get(edge.targetRef));
    const min = Math.min(sourceRank, targetRank);
    const max = Math.max(sourceRank, targetRank);
    const sourceBand = policy.bands.get(edge.sourceRef) || 0;
    const targetBand = policy.bands.get(edge.targetRef) || 0;
    const occupiedBand = sourceBand === targetBand
      ? sourceBand
      : (outgoingCount.get(edge.sourceRef) ?? 0) > 1
        ? targetBand
        : sourceBand;

    addBandInterval(
      intervals,
      getRequired(policy.components.get(edge.sourceRef)),
      occupiedBand,
      min,
      max
    );
  }

  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;
    const sourceRank = getRequired(ranks.rank.get(host));
    const targetRank = getRequired(ranks.rank.get(edge.targetRef));

    addBandInterval(
      intervals,
      getRequired(policy.components.get(host)),
      policy.bands.get(edge.targetRef) || 0,
      Math.min(sourceRank, targetRank),
      Math.max(sourceRank, targetRank),
      policy.boundaryBayEdges.has(edge)
    );
  }

  return intervals;
}

function addBandInterval(
    intervals: BandIntervals,
    component: number,
    band: number,
    min: number,
    max: number,
    boundary = false
): void {
  if (!band) {
    return;
  }

  const key = `${component}:${band}`;
  const existing = intervals.get(key);

  if (existing) {
    existing.spans.push({ min, max });
    existing.boundary ||= boundary;
  } else {
    intervals.set(key, {
      component,
      band,
      boundary,
      spans: [ { min, max } ]
    });
  }
}

function collectBoundaryHostBands(
    boundaryEdges: BoundaryEdge[],
    policy: SemanticPolicy
): BoundaryHostBands {
  const boundaryHosts: BoundaryHostBands = new Map();

  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;
    const component = policy.components.get(host);
    const targetBand = policy.bands.get(edge.targetRef) || 0;
    const key = `${component}:${targetBand}`;

    if (!boundaryHosts.has(key)) {
      boundaryHosts.set(key, []);
    }

    getRequired(boundaryHosts.get(key)).push(policy.bands.get(host) || 0);
  }

  return boundaryHosts;
}

function assignCompactedBands(
    intervals: BandIntervals,
    boundaryHosts: BoundaryHostBands
): BandMapping {
  const assigned: AssignedIntervals = new Map();
  const mapping: BandMapping = new Map();
  const ordered = [ ...intervals.values() ].sort((a, b) => {
    return a.component - b.component ||
      Math.sign(a.band) - Math.sign(b.band) ||
      Number(b.boundary) - Number(a.boundary) ||
      Math.abs(a.band) - Math.abs(b.band);
  });

  for (const interval of ordered) {
    const direction = Math.sign(interval.band);
    const minimumMagnitude = minimumCompactedMagnitude(
      interval,
      boundaryHosts,
      mapping,
      direction
    );
    let compacted = direction * minimumMagnitude;

    while (bandOverlaps(interval, assigned, compacted)) {
      compacted += direction;
    }

    const key = `${interval.component}:${compacted}`;
    const occupied = assigned.get(key) || [];

    occupied.push(interval);
    assigned.set(key, occupied);
    mapping.set(
      `${interval.component}:${interval.band}`,
      compacted
    );
  }

  return mapping;
}

function minimumCompactedMagnitude(
    interval: BandInterval,
    boundaryHosts: BoundaryHostBands,
    mapping: BandMapping,
    direction: number
): number {
  const hostBands = boundaryHosts.get(
    `${interval.component}:${interval.band}`
  ) || [];

  return hostBands.reduce((minimum, hostBand) => {
    if (Math.sign(hostBand) !== direction) {
      return minimum;
    }

    const compactedHost = mapping.get(
      `${interval.component}:${hostBand}`
    ) || hostBand;

    return Math.max(minimum, Math.abs(compactedHost) + 1);
  }, 1);
}

function bandOverlaps(
    interval: BandInterval,
    assigned: AssignedIntervals,
    compacted: number
): boolean {
  const key = `${interval.component}:${compacted}`;
  const occupied = assigned.get(key) || [];

  return occupied.some(existing => {
    return interval.spans.some(span => {
      return existing.spans.some(other => {
        return span.min <= other.max && span.max >= other.min;
      });
    });
  });
}

function applyCompactedBands(
    records: FlowRecord[],
    policy: SemanticPolicy,
    mapping: BandMapping
): void {
  for (const record of records) {
    const element = record.element;
    const band = policy.bands.get(element) || 0;

    if (band) {
      policy.bands.set(
        element,
        getRequired(mapping.get(`${getRequired(policy.components.get(element))}:${band}`))
      );
    }
  }
}
