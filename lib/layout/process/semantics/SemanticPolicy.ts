import { is } from '../../../di/DiUtil.js';
import { hasEventDefinition } from '../../bpmn/Predicates.js';
import type {
  LayoutRecord,
  RankAssignment,
  SemanticPolicy as LayoutSemanticPolicy
} from '../../Types.js';
import type { BpmnElement } from '../../bpmn/Types.js';
import type { ModdleElement } from 'moddle';
import type {
  BpmnBoundaryEvent,
  BpmnFlowElementsContainer,
  BpmnFlowNode,
  BpmnLane,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';

type FlowNode = ModdleElement<BpmnFlowNode> & {
  default?: FlowEdge;
  eventDefinitions?: BpmnElement[];
};
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};
type BoundaryEvent = ModdleElement<BpmnBoundaryEvent> & {
  attachedToRef: FlowNode;
};
type BoundaryEdge = FlowEdge & {
  sourceRef: BoundaryEvent;
};
type FlowRecord = LayoutRecord & {
  element: FlowNode;
};
type CompactFlowRegion = {
  split: FlowNode;
  join: FlowNode;
  paths: FlowEdge[][];
  primaryPath: FlowEdge[] | undefined;
};
type EdgeOrder = Map<FlowEdge, number>;
type SemanticPolicy = Omit<LayoutSemanticPolicy,
  'spine' | 'straightEdges' | 'bands' | 'components' | 'edgeOrder' |
  'flowNodeDocumentIndex' | 'graphEdges' | 'compactFlowRegions' |
  'rankWeights' | 'backEdges' | 'boundaryBayEdges'
> & {
  spine: Set<FlowEdge>;
  straightEdges: Set<FlowEdge>;
  bands: Map<FlowNode, number>;
  components: Map<FlowNode, number>;
  edgeOrder: EdgeOrder;
  flowNodeDocumentIndex: FlowNodeIndex;
  graphEdges: FlowEdge[];
  compactFlowRegions: CompactFlowRegion[];
  rankWeights: Map<FlowEdge, number>;
  backEdges: Set<FlowEdge>;
  boundaryBayEdges: Set<FlowEdge>;
};
type OutgoingEdges = Map<FlowNode, FlowEdge[]>;
type FlowNodeIndex = Map<FlowNode, number>;
type LinkEvents = {
  throwEvent?: FlowNode;
  catchEvent?: FlowNode;
};
type BoundaryEdgesByEvent = Map<BoundaryEvent, BoundaryEdge[]>;
type BoundaryEdgesBySide = {
  top: BoundaryEdgesByEvent;
  bottom: BoundaryEdgesByEvent;
};

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected semantic layout value');
  }

  return value;
}

function getOutgoing(outgoing: OutgoingEdges, node: FlowNode): FlowEdge[] {
  return getRequired(outgoing.get(node));
}

function isFlowElementsContainer(
    element: unknown
): element is ModdleElement<BpmnFlowElementsContainer> {
  return is(element, 'bpmn:Process') || is(element, 'bpmn:SubProcess');
}

const EDGE_PRIORITY = {
  SPINE: 0,
  STRAIGHT: 1,
  CROSS_BAND_GATEWAY_BRANCH: 2,
  STANDARD: 3,
  BACK_EDGE: 4
};

export function createSemanticPolicy(
    scope: BpmnElement,
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    allRecords: LayoutRecord[]
): SemanticPolicy {
  const {
    allElementsDocumentIndex,
    edgeOrder,
    flowNodeDocumentIndex,
    outgoing
  } = createSemanticIndexes(
    records,
    graphEdges,
    boundaryEdges,
    allRecords
  );
  const compactFlowRegions = is(scope, 'bpmn:AdHocSubProcess')
    ? findCompactFlowRegions(records, graphEdges, outgoing, edgeOrder)
    : [];
  const rankWeights = createCompactRankWeights(compactFlowRegions);
  const backEdges = findBackEdges(
    records,
    graphEdges,
    boundaryEdges,
    flowNodeDocumentIndex
  );
  const components = findConnectedComponents(
    records,
    graphEdges,
    boundaryEdges
  );
  const spine = selectSemanticSpine(
    scope,
    records,
    graphEdges,
    outgoing,
    edgeOrder,
    components
  );
  const straightEdges = selectStraightEdges(
    records,
    outgoing,
    edgeOrder,
    spine
  );
  const bands = assignSemanticBands(
    records,
    graphEdges,
    boundaryEdges,
    straightEdges,
    flowNodeDocumentIndex,
    allElementsDocumentIndex,
    edgeOrder,
    components,
    backEdges
  );

  adjustJoinRankWeights(graphEdges, bands, rankWeights);
  alignLinkEventContinuationBands(records, graphEdges, bands);

  return {
    spine,
    straightEdges,
    bands,
    components,
    edgeOrder,
    flowNodeDocumentIndex,
    graphEdges,
    compactFlowRegions,
    rankWeights,
    backEdges,
    boundaryBayEdges: new Set<FlowEdge>()
  };
}

function createSemanticIndexes(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    allRecords: LayoutRecord[]
) {
  const edgeOrder: EdgeOrder = new Map();
  const flowNodeDocumentIndex: FlowNodeIndex = new Map();
  const allElementsDocumentIndex = new Map<BpmnElement, number>();
  const outgoing: OutgoingEdges = new Map();

  for (const record of records) {
    flowNodeDocumentIndex.set(record.element, record.index);
    outgoing.set(record.element, []);
  }
  for (const record of allRecords) {
    allElementsDocumentIndex.set(record.element, record.index);
  }

  graphEdges.forEach((edge, edgeIndex) => {
    edgeOrder.set(edge, edgeIndex);
    getOutgoing(outgoing, edge.sourceRef).push(edge);
  });
  boundaryEdges.forEach((edge, edgeIndex) => edgeOrder.set(edge, graphEdges.length + edgeIndex));

  return {
    edgeOrder,
    flowNodeDocumentIndex,
    allElementsDocumentIndex,
    outgoing
  };
}

function findBackEdges(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    flowNodeDocumentIndex: FlowNodeIndex
) {
  const cycleOutgoing: OutgoingEdges = new Map();

  for (const record of records) {
    cycleOutgoing.set(record.element, []);
  }

  for (const edge of graphEdges) {
    getOutgoing(cycleOutgoing, edge.sourceRef).push(edge);
  }
  for (const edge of boundaryEdges) {
    getOutgoing(cycleOutgoing, edge.sourceRef.attachedToRef).push(edge);
  }

  const backEdges = new Set<FlowEdge>();

  markBackEdges(
    records.map(record => record.element),
    cycleOutgoing,
    backEdges,
    flowNodeDocumentIndex
  );

  return backEdges;
}

function findConnectedComponents(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[]
): Map<FlowNode, number> {
  const components = new Map<FlowNode, number>();
  const claimed = new Set<FlowNode>();
  const adjacent = new Map<FlowNode, FlowNode[]>();

  for (const record of records) {
    adjacent.set(record.element, []);
  }
  let componentIndex = 0;

  for (const edge of graphEdges) {
    getRequired(adjacent.get(edge.sourceRef)).push(edge.targetRef);
    getRequired(adjacent.get(edge.targetRef)).push(edge.sourceRef);
  }
  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;

    getRequired(adjacent.get(host)).push(edge.targetRef);
    getRequired(adjacent.get(edge.targetRef)).push(host);
  }

  for (const seed of records.map(record => record.element)) {
    if (claimed.has(seed)) {
      continue;
    }

    const componentQueue = [ seed ];
    claimed.add(seed);
    components.set(seed, componentIndex);

    while (componentQueue.length) {
      const element = getRequired(componentQueue.shift());

      for (const neighbor of getRequired(adjacent.get(element))) {
        if (!claimed.has(neighbor)) {
          claimed.add(neighbor);
          components.set(neighbor, componentIndex);
          componentQueue.push(neighbor);
        }
      }
    }

    componentIndex++;
  }

  return components;
}

function selectSemanticSpine(
    scope: BpmnElement,
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    outgoing: OutgoingEdges,
    edgeOrder: EdgeOrder,
    components: Map<FlowNode, number>
): Set<FlowEdge> {
  const spine = new Set<FlowEdge>();
  const starts = records.filter(record => is(record.element, 'bpmn:StartEvent'))
    .sort((a, b) => a.index - b.index);
  const incomingNodes = new Set(graphEdges.map(edge => edge.targetRef));
  const sourceNodes = records.filter(record => {
    return !incomingNodes.has(record.element);
  }).map(record => record.element);
  const primarySeed = starts[0]?.element ||
    sourceNodes[0] ||
    records[0]?.element;
  const adHocSources = is(scope, 'bpmn:AdHocSubProcess') ? sourceNodes : [];
  const seeds: Array<FlowNode | undefined> = [
    primarySeed,
    ...adHocSources,
    ...records.filter(record => {
      return is(record.element, 'bpmn:IntermediateCatchEvent') &&
        (record.element.eventDefinitions || []).some(definition => {
          return is(definition, 'bpmn:LinkEventDefinition');
        });
    }).map(record => record.element)
  ];
  const visited = new Set<FlowNode>();
  const mainComponent = primarySeed ? components.get(primarySeed) : undefined;
  const componentSeeds = new Map<number, FlowNode>();

  for (const record of starts) {
    const component = getRequired(components.get(record.element));

    if (!componentSeeds.has(component)) {
      componentSeeds.set(component, record.element);
    }
  }

  seeds.push(...componentSeeds.values());

  for (const seed of seeds) {
    if (!seed || visited.has(seed)) {
      continue;
    }

    if (!is(scope, 'bpmn:AdHocSubProcess') &&
        seed !== primarySeed && components.get(seed) === mainComponent) {
      continue;
    }

    let current = seed;

    while (current && !visited.has(current)) {
      visited.add(current);
      const candidates = outgoing.get(current) || [];
      const next = selectPrimaryEdge(
        current,
        candidates,
        edgeOrder,
        visited,
        outgoing
      );

      if (!next) {
        break;
      }

      spine.add(next);
      current = next.targetRef;
    }
  }

  return spine;
}

function selectStraightEdges(
    records: FlowRecord[],
    outgoing: OutgoingEdges,
    edgeOrder: EdgeOrder,
    spine: Set<FlowEdge>
): Set<FlowEdge> {
  const straightEdges = new Set<FlowEdge>(spine);

  for (const record of records) {
    const candidates = outgoing.get(record.element) || [];

    if (is(record.element, 'bpmn:Gateway') && candidates.length > 1) {
      const primaryEdge = selectPrimaryEdge(
        record.element,
        candidates,
        edgeOrder,
        new Set<FlowNode>(),
        outgoing
      );

      if (primaryEdge) {
        straightEdges.add(primaryEdge);
      }
    }
  }

  const straightTargets = [ ...straightEdges ].map(edge => edge.targetRef);

  while (straightTargets.length) {
    const node = straightTargets.shift();
    const candidates = node ? outgoing.get(node) || [] : [];

    if (candidates.length !== 1 || straightEdges.has(candidates[0])) {
      continue;
    }

    straightEdges.add(candidates[0]);
    straightTargets.push(candidates[0].targetRef);
  }

  return straightEdges;
}

function adjustJoinRankWeights(
    graphEdges: FlowEdge[],
    bands: Map<FlowNode, number>,
    rankWeights: Map<FlowEdge, number>
): void {
  for (const edge of graphEdges) {
    const sourceIsJoin = is(edge.sourceRef, 'bpmn:Gateway') &&
      (edge.sourceRef.incoming || []).length > 1 &&
      (edge.sourceRef.outgoing || []).length === 1;
    const targetIsJoin = is(edge.targetRef, 'bpmn:Gateway') &&
      (edge.targetRef.incoming || []).length > 1;

    if (sourceIsJoin && targetIsJoin &&
        edge.sourceRef.$type === edge.targetRef.$type &&
        bands.get(edge.sourceRef) !== bands.get(edge.targetRef)) {
      rankWeights.set(edge, 0);
    }
  }
}

function findCompactFlowRegions(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    outgoing: OutgoingEdges,
    edgeOrder: EdgeOrder
): CompactFlowRegion[] {
  const incomingCount = new Map<FlowNode, number>();

  for (const record of records) {
    incomingCount.set(record.element, 0);
  }

  for (const edge of graphEdges) {
    incomingCount.set(edge.targetRef, (incomingCount.get(edge.targetRef) ?? 0) + 1);
  }

  const regions: CompactFlowRegion[] = [];

  for (const record of records) {
    const split = record.element;
    const branches = outgoing.get(split) || [];

    if (branches.length < 2) {
      continue;
    }

    const distances = branches.map(branch => {
      return descendantDistances(branch.targetRef, outgoing, split);
    });
    const common = [ ...getRequired(distances[0]).keys() ].filter(node => {
      return node !== split &&
        (incomingCount.get(node) ?? 0) > 1 &&
        distances.every(distance => distance.has(node));
    });

    if (!common.length) {
      continue;
    }

    const join = common.sort((a, b) => {
      const distancesA = distances.map(distance => getRequired(distance.get(a)));
      const distancesB = distances.map(distance => getRequired(distance.get(b)));

      return Math.max(...distancesA) - Math.max(...distancesB) ||
        distancesA.reduce((sum, distance) => sum + distance, 0) -
          distancesB.reduce((sum, distance) => sum + distance, 0) ||
        indexOfNode(a, records) - indexOfNode(b, records);
    })[0];
    const paths = branches.map(branch => {
      return [
        branch,
        ...shortestFlowPath(branch.targetRef, join, outgoing, edgeOrder, split)
      ];
    });
    const primaryEdge = selectPrimaryEdge(split, branches, edgeOrder, new Set(), outgoing);
    const primaryPath = paths.find(path => path[0] === primaryEdge);

    regions.push({ split, join, paths, primaryPath });
  }

  return regions;
}

function descendantDistances(
    start: FlowNode,
    outgoing: OutgoingEdges,
    blocked: FlowNode
): Map<FlowNode, number> {
  const distances = new Map<FlowNode, number>([ [ start, 0 ] ]);
  const pending: FlowNode[] = [ start ];

  while (pending.length) {
    const node = getRequired(pending.shift());

    for (const edge of outgoing.get(node) || []) {
      const target = edge.targetRef;

      if (target === blocked || distances.has(target)) {
        continue;
      }

      distances.set(target, getRequired(distances.get(node)) + 1);
      pending.push(target);
    }
  }

  return distances;
}

function shortestFlowPath(
    start: FlowNode,
    target: FlowNode,
    outgoing: OutgoingEdges,
    edgeOrder: EdgeOrder,
    blocked: FlowNode
): FlowEdge[] {
  if (start === target) {
    return [];
  }

  const pending: FlowNode[] = [ start ];
  const previous = new Map<FlowNode, FlowEdge>();
  const visited = new Set<FlowNode>([ start, blocked ]);

  while (pending.length) {
    const node = getRequired(pending.shift());
    const edges = [ ...(outgoing.get(node) || []) ]
      .sort((a, b) => (edgeOrder.get(a) ?? 0) - (edgeOrder.get(b) ?? 0));

    for (const edge of edges) {
      if (visited.has(edge.targetRef)) {
        continue;
      }

      visited.add(edge.targetRef);
      previous.set(edge.targetRef, edge);

      if (edge.targetRef === target) {
        const path: FlowEdge[] = [];

        for (let current = target; current !== start;) {
          const previousEdge = getRequired(previous.get(current));

          path.unshift(previousEdge);
          current = previousEdge.sourceRef;
        }

        return path;
      }

      pending.push(edge.targetRef);
    }
  }

  return [];
}

function indexOfNode(node: FlowNode, records: FlowRecord[]): number {
  return records.find(record => record.element === node)?.index ?? Infinity;
}

function createCompactRankWeights(
    regions: CompactFlowRegion[]
): Map<FlowEdge, number> {
  const weights = new Map<FlowEdge, number>();

  for (const { paths, primaryPath } of regions) {
    if (!primaryPath) {
      continue;
    }

    const span = primaryPath.length;

    for (const path of paths) {
      if (path === primaryPath) {
        continue;
      }

      const internalCount = path.length - 1;
      const offsets = [ 0 ];

      for (let index = 1; index <= internalCount; index++) {
        const offset = internalCount === 1
          ? Math.floor(span / 2)
          : Math.floor((index - 1) * span / (internalCount - 1));

        offsets.push(offset);
      }
      offsets.push(span);

      path.forEach((edge, index) => {
        const weight = offsets[index + 1] - offsets[index];
        const existing = weights.get(edge);

        weights.set(edge, existing === undefined ? weight : Math.min(existing, weight));
      });
    }
  }

  return weights;
}

function alignLinkEventContinuationBands(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    bands: Map<FlowNode, number>
): void {
  const links = new Map<string, LinkEvents>();
  const outgoing: OutgoingEdges = new Map();
  const incomingCount = new Map<FlowNode, number>();

  for (const record of records) {
    outgoing.set(record.element, []);
    incomingCount.set(record.element, 0);
  }

  for (const record of records) {
    incomingCount.set(record.element, 0);
  }

  for (const edge of graphEdges) {
    getOutgoing(outgoing, edge.sourceRef).push(edge);
    incomingCount.set(edge.targetRef, (incomingCount.get(edge.targetRef) ?? 0) + 1);
  }

  for (const record of records) {
    const definition = (record.element.eventDefinitions || []).find(candidate => {
      return is(candidate, 'bpmn:LinkEventDefinition');
    });

    if (!definition) {
      continue;
    }

    const name = definition.name || '';

    if (!links.has(name)) {
      links.set(name, {});
    }

    if (is(record.element, 'bpmn:IntermediateThrowEvent')) {
      getRequired(links.get(name)).throwEvent = record.element;
    } else if (is(record.element, 'bpmn:IntermediateCatchEvent')) {
      getRequired(links.get(name)).catchEvent = record.element;
    }
  }

  for (const { throwEvent, catchEvent } of links.values()) {
    if (!throwEvent || !catchEvent) {
      continue;
    }

    const offset = (bands.get(throwEvent) || 0) - (bands.get(catchEvent) || 0);
    const pending: FlowNode[] = [ catchEvent ];
    const visited = new Set<FlowNode>();

    while (pending.length) {
      const element = getRequired(pending.shift());

      if (visited.has(element)) {
        continue;
      }

      visited.add(element);
      bands.set(element, (bands.get(element) || 0) + offset);

      for (const edge of outgoing.get(element) || []) {
        if ((incomingCount.get(edge.targetRef) ?? 0) <= 1) {
          pending.push(edge.targetRef);
        }
      }
    }
  }
}

function assignBoundaryBandOffsets(
    boundaryEdges: BoundaryEdge[],
    flowNodeDocumentIndex: Map<BpmnElement, number>
): Map<BoundaryEdge, number> {
  const edgesByHost = new Map<FlowNode, BoundaryEdgesBySide>();

  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;
    const side = hasEventDefinition(edge.sourceRef, 'bpmn:EscalationEventDefinition')
      ? 'top'
      : 'bottom';

    if (!edgesByHost.has(host)) {
      edgesByHost.set(host, {
        top: new Map<BoundaryEvent, BoundaryEdge[]>(),
        bottom: new Map<BoundaryEvent, BoundaryEdge[]>()
      });
    }

    const edgesByEvent = getRequired(edgesByHost.get(host))[side];

    if (!edgesByEvent.has(edge.sourceRef)) {
      edgesByEvent.set(edge.sourceRef, []);
    }

    getRequired(edgesByEvent.get(edge.sourceRef)).push(edge);
  }

  const assigned = new Map<BoundaryEdge, number>();

  for (const [ , sides ] of edgesByHost) {
    for (const [ side, edgesByEvent ] of Object.entries(sides)) {
      let offset = 1;
      const direction = side === 'top' ? -1 : 1;
      const eventGroups = [ ...edgesByEvent.entries() ]
        .sort(([ eventA ], [ eventB ]) => (flowNodeDocumentIndex.get(eventB) ?? 0) - (flowNodeDocumentIndex.get(eventA) ?? 0))
        .map(([ , edges ]) => edges);

      for (const edges of eventGroups) {
        for (const edge of edges) {
          assigned.set(edge, direction * offset);
          offset++;
        }
      }
    }
  }

  return assigned;
}

function assignSemanticBands(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    straightEdges: Set<FlowEdge>,
    flowNodeDocumentIndex: FlowNodeIndex,
    allElementsDocumentIndex: Map<BpmnElement, number>,
    edgeIndex: EdgeOrder,
    components: Map<FlowNode, number>,
    backEdges: Set<FlowEdge>
): Map<FlowNode, number> {
  const nodes = records.map(record => record.element);
  const outgoing: OutgoingEdges = new Map();
  const incomingCount = new Map<FlowNode, number>();

  for (const node of nodes) {
    outgoing.set(node, []);
    incomingCount.set(node, 0);
  }

  for (const edge of graphEdges) {
    getOutgoing(outgoing, edge.sourceRef).push(edge);
  }

  for (const edge of graphEdges) {
    if (!backEdges.has(edge)) {
      incomingCount.set(edge.targetRef, (incomingCount.get(edge.targetRef) ?? 0) + 1);
    }
  }

  const bands = new Map<FlowNode, number>();
  const occupied = new Map<number, Set<number>>();
  const visited = new Set<FlowNode>();

  for (const node of nodes) {
    bands.set(node, 0);
  }

  const reserveBand = (component: number, base: number, offset: number): number => {
    if (!occupied.has(component)) {
      occupied.set(component, new Set([ 0 ]));
    }

    const used = getRequired(occupied.get(component));
    const direction = Math.sign(offset);
    let candidate = base + offset;

    while (used.has(candidate)) {
      candidate += direction;
    }

    used.add(candidate);
    return candidate;
  };
  const visit = (node: FlowNode, band: number, component = getRequired(components.get(node))): void => {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    bands.set(node, band);

    if (!occupied.has(component)) {
      occupied.set(component, new Set());
    }
    getRequired(occupied.get(component)).add(band);

    const candidates = (outgoing.get(node) || [])
      .filter(edge => !backEdges.has(edge))
      .sort((a, b) => (edgeIndex.get(a) ?? 0) - (edgeIndex.get(b) ?? 0));
    const primary = candidates.find(edge => straightEdges.has(edge)) || candidates[0];

    if (primary) {
      visit(primary.targetRef, band, component);
    }

    let branchIndex = 0;

    for (const edge of candidates) {
      if (edge === primary) {
        continue;
      }

      const oneSided = Boolean(node.default);
      const outwardDirection = oneSided && band !== 0 ? Math.sign(band) : 1;
      const offset = branchOffset(branchIndex++, oneSided) * outwardDirection;

      visit(edge.targetRef, reserveBand(component, band, offset), component);
    }
  };
  const boundaryTargets = new Set<FlowNode>(boundaryEdges.map(edge => edge.targetRef));
  const sources = records
    .filter(record => incomingCount.get(record.element) === 0 && !boundaryTargets.has(record.element))
    .sort((a, b) => a.index - b.index);

  for (const record of sources) {
    visit(record.element, 0);
  }

  const boundaryOffsets = assignBoundaryBandOffsets(boundaryEdges, allElementsDocumentIndex);

  for (const edge of [ ...boundaryEdges ].sort((a, b) => (edgeIndex.get(a) ?? 0) - (edgeIndex.get(b) ?? 0))) {
    if (visited.has(edge.targetRef)) {
      continue;
    }

    const host = edge.sourceRef.attachedToRef;
    const component = getRequired(components.get(host));
    const hostBand = bands.get(host) || 0;

    visit(
      edge.targetRef,
      reserveBand(component, hostBand, getRequired(boundaryOffsets.get(edge))),
      component
    );
  }

  for (const record of [ ...records ].sort((a, b) => a.index - b.index)) {
    visit(record.element, 0);
  }

  return bands;
}

function selectPrimaryEdge(
    node: FlowNode,
    edges: FlowEdge[],
    edgeOrder: EdgeOrder,
    visited: Set<FlowNode> = new Set(),
    outgoing: OutgoingEdges = new Map()
): FlowEdge | null {
  if (!edges.length) {
    return null;
  }

  const defaultEdge = node.default;
  const forwardEdges = edges.filter(edge => !visited.has(edge.targetRef));
  const candidates = forwardEdges.length ? forwardEdges : edges;
  const endReaching = candidates.filter(edge => {
    return canReachEndEvent(edge.targetRef, outgoing, new Set([ node ]));
  });
  const preferred = endReaching.length ? endReaching : candidates;

  return preferred.find(edge => edge === defaultEdge) ||
    [ ...preferred ].sort((a, b) => (edgeOrder.get(a) ?? 0) - (edgeOrder.get(b) ?? 0))[0] || null;
}

function canReachEndEvent(
    node: FlowNode,
    outgoing: OutgoingEdges,
    path: Set<FlowNode>
): boolean {
  if (is(node, 'bpmn:EndEvent')) {
    return true;
  }

  if (path.has(node)) {
    return false;
  }

  path.add(node);

  for (const edge of outgoing.get(node) || []) {
    if (canReachEndEvent(edge.targetRef, outgoing, path)) {
      path.delete(node);
      return true;
    }
  }

  path.delete(node);
  return false;
}

function branchOffset(index: number, oneSided = false): number {
  if (oneSided) {
    return index + 1;
  }

  const distance = Math.floor(index / 2) + 1;

  return index % 2 === 0 ? distance : -distance;
}

export function assignRanks(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    policy: SemanticPolicy
): RankAssignment {
  const rank = new Map<FlowNode, number>();
  const outgoing: OutgoingEdges = new Map();
  const indegree = new Map<FlowNode, number>();

  for (const record of records) {
    rank.set(record.element, 0);
    outgoing.set(record.element, []);
    indegree.set(record.element, 0);
  }
  const backEdges = policy.backEdges;

  for (const edge of graphEdges) {
    getOutgoing(outgoing, edge.sourceRef).push(edge);
  }

  for (const edge of graphEdges) {
    if (!backEdges.has(edge)) {
      indegree.set(edge.targetRef, (indegree.get(edge.targetRef) ?? 0) + 1);
    }
  }

  const ready = records.filter(record => indegree.get(record.element) === 0)
    .sort((a, b) => a.index - b.index);
  const processed = new Set<FlowNode>();

  while (ready.length) {
    const record = getRequired(ready.shift());
    const source = record.element;

    if (processed.has(source)) {
      continue;
    }

    processed.add(source);

    for (const edge of getOutgoing(outgoing, source)) {
      if (backEdges.has(edge)) {
        continue;
      }

      const weight = policy.rankWeights.get(edge) ?? 1;

      rank.set(
        edge.targetRef,
        Math.max(getRequired(rank.get(edge.targetRef)), getRequired(rank.get(source)) + weight)
      );
      indegree.set(edge.targetRef, (indegree.get(edge.targetRef) ?? 0) - 1);

      if (indegree.get(edge.targetRef) === 0) {
        const targetRecord = records.find(candidate => candidate.element === edge.targetRef);

        if (targetRecord) {
          ready.push(targetRecord);
        }
        ready.sort((a, b) => a.index - b.index);
      }
    }
  }

  for (const record of records) {
    if (!processed.has(record.element)) {
      rank.set(record.element, 0);
    }
  }

  reserveGatewayBranchSpans(rank, outgoing, policy.spine, backEdges);
  stabilizeRanks(rank, graphEdges, boundaryEdges, policy, records.length);

  // Each changing pass advances at least one spine continuation; there can be
  // no more dependent reservations than spine edges.
  for (
    let iteration = 0;
    !policy.compactFlowRegions.length && iteration < policy.spine.size;
    iteration++
  ) {
    const changed = reserveDetachedBranchSpans(
      rank,
      outgoing,
      boundaryEdges,
      policy.spine,
      backEdges,
      records,
      policy
    );

    if (!changed) {
      break;
    }

    stabilizeRanks(rank, graphEdges, boundaryEdges, policy, records.length);
  }

  return { rank };
}

function reserveGatewayBranchSpans(
    rank: Map<FlowNode, number>,
    outgoing: OutgoingEdges,
    spine: Set<FlowEdge>,
    backEdges: Set<FlowEdge>
): void {
  const spineNodes = new Set<FlowNode>();

  for (const edge of spine) {
    spineNodes.add(edge.sourceRef);
    spineNodes.add(edge.targetRef);
  }

  for (const spineEdge of spine) {
    if (!is(spineEdge.targetRef, 'bpmn:Gateway')) {
      continue;
    }

    const branches = (outgoing.get(spineEdge.sourceRef) || []).filter(edge => {
      return edge !== spineEdge && !backEdges.has(edge);
    });
    let reservedUntil = getRequired(rank.get(spineEdge.targetRef));

    for (const branch of branches) {
      const branchEnd = findDetachedBranchEnd(
        branch,
        rank,
        outgoing,
        spineNodes,
        backEdges
      );

      if (branchEnd !== null) {
        reservedUntil = Math.max(getRequired(reservedUntil), branchEnd + 1);
      }
    }

    rank.set(spineEdge.targetRef, getRequired(reservedUntil));
  }
}

function stabilizeRanks(
    rank: Map<FlowNode, number>,
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    policy: SemanticPolicy,
    maxIterations: number
): void {
  const backEdges = policy.backEdges;

  // Boundary handlers enter the normal graph after their host rank is known.
  // Resolve them together with normal flow so downstream ranks follow any
  // horizontal space reserved for detached alternatives.
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false;

    for (const edge of graphEdges) {
      if (backEdges.has(edge)) {
        continue;
      }

      const candidate = getRequired(rank.get(edge.sourceRef)) + (policy.rankWeights.get(edge) ?? 1);

      if (candidate > getRequired(rank.get(edge.targetRef))) {
        rank.set(edge.targetRef, candidate);
        changed = true;
      }

    }

    for (const edge of boundaryEdges) {
      if (backEdges.has(edge)) {
        continue;
      }

      const hostRank = getRequired(rank.get(edge.sourceRef.attachedToRef));
      const candidate = hostRank + 1;

      if (candidate > getRequired(rank.get(edge.targetRef))) {
        rank.set(edge.targetRef, candidate);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }
}

function reserveDetachedBranchSpans(
    rank: Map<FlowNode, number>,
    outgoing: OutgoingEdges,
    boundaryEdges: BoundaryEdge[],
    spine: Set<FlowEdge>,
    backEdges: Set<FlowEdge>,
    records: FlowRecord[],
    policy: SemanticPolicy
): boolean {
  const spineNodes = new Set<FlowNode>();
  const boundaryBranches = new Map<FlowNode, BoundaryEdge[]>();
  const laneByNode = getLaneMemberships(records);
  let changed = false;

  for (const edge of spine) {
    spineNodes.add(edge.sourceRef);
    spineNodes.add(edge.targetRef);
  }

  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;

    if (!boundaryBranches.has(host)) {
      boundaryBranches.set(host, []);
    }
    getRequired(boundaryBranches.get(host)).push(edge);
  }

  for (const spineEdge of spine) {
    const sourceBoundaryBranches = (boundaryBranches.get(spineEdge.sourceRef) || [])
      .filter(edge => !backEdges.has(edge));
    const continuationBranches = [
      ...(outgoing.get(spineEdge.targetRef) || []),
      ...(boundaryBranches.get(spineEdge.targetRef) || [])
    ].filter(edge => !backEdges.has(edge));
    const targetIsJoin = (spineEdge.targetRef.incoming || []).length > 1;
    const reserveBoundaryBay = sourceBoundaryBranches.length && targetIsJoin;
    const boundaryBayOnly = continuationBranches.length < 2;

    if (continuationBranches.length < 2 && !reserveBoundaryBay) {
      continue;
    }

    const branches = boundaryBayOnly
      ? sourceBoundaryBranches
      : [
        ...(outgoing.get(spineEdge.sourceRef) || []).filter(edge => edge !== spineEdge),
        ...sourceBoundaryBranches
      ].filter(edge => !backEdges.has(edge));
    const sourceRank = getRequired(rank.get(spineEdge.sourceRef));
    let reservedUntil = getRequired(rank.get(spineEdge.targetRef));

    for (const branch of branches) {
      const branchEnd = findDetachedBranchEnd(
        branch,
        rank,
        outgoing,
        spineNodes,
        backEdges,
        sourceRank,
        boundaryBayOnly ? laneByNode : null
      );

      if (branchEnd !== null) {
        if (boundaryBayOnly) {
          policy.boundaryBayEdges.add(branch);
        }

        reservedUntil = Math.max(getRequired(reservedUntil), branchEnd + 1);
      }
    }

    if (reservedUntil > getRequired(rank.get(spineEdge.targetRef))) {
      rank.set(spineEdge.targetRef, getRequired(reservedUntil));
      changed = true;
    }
  }

  return changed;
}

function getLaneMemberships(records: FlowRecord[]): Map<FlowNode, ModdleElement<BpmnLane>> {
  const laneByNode = new Map<FlowNode, ModdleElement<BpmnLane>>();
  const scopes = new Set(records.map(record => record.element.$parent)
    .filter(isFlowElementsContainer));
  const visitLane = (lane: ModdleElement<BpmnLane>): void => {
    for (const node of lane.flowNodeRef || []) {
      laneByNode.set(node, lane);
    }
    for (const child of lane.childLaneSet?.lanes || []) {
      visitLane(child);
    }
  };

  for (const scope of scopes) {
    for (const laneSet of scope.laneSets || []) {
      for (const lane of laneSet.lanes || []) {
        visitLane(lane);
      }
    }
  }

  return laneByNode;
}

function findDetachedBranchEnd(
    branch: FlowEdge,
    rank: Map<FlowNode, number>,
    outgoing: OutgoingEdges,
    spineNodes: Set<FlowNode>,
    backEdges: Set<FlowEdge>,
    sourceRank: number | null = null,
    laneByNode: Map<FlowNode, ModdleElement<BpmnLane>> | null = null
): number | null {
  const pending = [ { node: branch.targetRef, distance: 1 } ];
  const visited = new Set<FlowNode>();
  let detached = true;
  let cyclic = false;
  let lane: ModdleElement<BpmnLane> | null = null;
  let laneInitialized = false;
  let branchEnd = sourceRank === null
    ? getRequired(rank.get(branch.targetRef))
    : sourceRank + 1;

  while (pending.length) {
    const { node, distance } = getRequired(pending.shift());

    if (visited.has(node)) {
      continue;
    }

    visited.add(node);
    branchEnd = Math.max(branchEnd, getRequired(rank.get(node)));

    if (laneByNode) {
      const nodeLane = laneByNode.get(node) || null;

      if (laneInitialized && nodeLane !== lane) {
        detached = false;
      } else {
        lane = nodeLane;
        laneInitialized = true;
      }
    }

    if (sourceRank !== null) {
      branchEnd = Math.max(branchEnd, sourceRank + distance);
    }

    if (spineNodes.has(node)) {
      detached = false;
      continue;
    }

    for (const edge of outgoing.get(node) || []) {
      if (backEdges.has(edge)) {
        cyclic = true;
      } else {
        pending.push({
          node: edge.targetRef,
          distance: distance + 1
        });
      }
    }
  }

  return detached && !cyclic ? branchEnd : null;
}

function markBackEdges(
    nodes: FlowNode[],
    outgoing: OutgoingEdges,
    backEdges: Set<FlowEdge>,
    flowNodeDocumentIndex: FlowNodeIndex
): void {
  const state = new Map<FlowNode, 'visiting' | 'visited'>();
  const incomingCount = new Map<FlowNode, number>();

  for (const node of nodes) {
    incomingCount.set(node, 0);
  }

  for (const edges of outgoing.values()) {
    for (const edge of edges) {
      incomingCount.set(edge.targetRef, (incomingCount.get(edge.targetRef) ?? 0) + 1);
    }
  }

  function visit(node: FlowNode): void {
    state.set(node, 'visiting');
    const edges = [ ...(outgoing.get(node) || []) ].sort((a, b) => (flowNodeDocumentIndex.get(a.targetRef) ?? 0) - (flowNodeDocumentIndex.get(b.targetRef) ?? 0));

    for (const edge of edges) {
      const targetState = state.get(edge.targetRef);

      if (targetState === 'visiting') {
        backEdges.add(edge);
      } else if (!targetState) {
        visit(edge.targetRef);
      }
    }

    state.set(node, 'visited');
  }

  const ordered = [ ...nodes ].sort((a, b) => {
    const sourceA = incomingCount.get(a) === 0;
    const sourceB = incomingCount.get(b) === 0;

    if (sourceA !== sourceB) {
      return sourceA ? -1 : 1;
    }

    const startA = is(a, 'bpmn:StartEvent');
    const startB = is(b, 'bpmn:StartEvent');

    if (startA !== startB) {
      return startA ? -1 : 1;
    }

    return (flowNodeDocumentIndex.get(a) ?? 0) - (flowNodeDocumentIndex.get(b) ?? 0);
  });

  for (const node of ordered) {
    if (!state.has(node)) {
      visit(node);
    }
  }
}

export function edgePriority(
    edge: FlowEdge,
    policy: SemanticPolicy | null
): number {
  if (!policy) {
    return EDGE_PRIORITY.STANDARD;
  }

  if (policy.spine.has(edge)) {
    return EDGE_PRIORITY.SPINE;
  }

  if (policy.straightEdges.has(edge)) {
    return EDGE_PRIORITY.STRAIGHT;
  }

  const sourceBand = policy.bands.get(edge.sourceRef) || 0;
  const targetBand = policy.bands.get(edge.targetRef) || 0;
  const crossBandGatewayBranch = is(edge.sourceRef, 'bpmn:Gateway') &&
    (edge.sourceRef.outgoing || []).length > 1 &&
    sourceBand !== targetBand;

  if (!policy.backEdges.has(edge) && crossBandGatewayBranch) {
    return EDGE_PRIORITY.CROSS_BAND_GATEWAY_BRANCH;
  }

  if (policy.backEdges.has(edge)) {
    return EDGE_PRIORITY.BACK_EDGE;
  }

  return EDGE_PRIORITY.STANDARD;
}
