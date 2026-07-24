import { is } from '../di/DiUtil.js';
import { hasEventDefinition } from './BpmnUtil.js';

const EDGE_PRIORITY = {
  SPINE: 0,
  STRAIGHT: 1,
  CROSS_BAND_GATEWAY_BRANCH: 2,
  STANDARD: 3,
  BACK_EDGE: 4
};

export function createSemanticPolicy(scope, records, graphEdges, boundaryEdges, allRecords) {
  const edgeOrder = new Map();
  const flowNodeDocumentIndex = new Map(records.map(record => [ record.element, record.index ]));
  const allElementsDocumentIndex = new Map(allRecords.map(record => [ record.element, record.index ]));
  const outgoing = new Map(records.map(record => [ record.element, [] ]));

  graphEdges.forEach((edge, edgeIndex) => {
    edgeOrder.set(edge, edgeIndex);
    outgoing.get(edge.sourceRef).push(edge);
  });
  boundaryEdges.forEach((edge, edgeIndex) => edgeOrder.set(edge, graphEdges.length + edgeIndex));

  const compactFlowRegions = is(scope, 'bpmn:AdHocSubProcess')
    ? findCompactFlowRegions(records, graphEdges, outgoing, edgeOrder)
    : [];
  const rankWeights = createCompactRankWeights(compactFlowRegions);
  const cycleOutgoing = new Map(records.map(record => [ record.element, [] ]));

  for (const edge of graphEdges) {
    cycleOutgoing.get(edge.sourceRef).push(edge);
  }
  for (const edge of boundaryEdges) {
    cycleOutgoing.get(edge.sourceRef.attachedToRef).push(edge);
  }

  const backEdges = new Set();

  markBackEdges(
    records.map(record => record.element),
    cycleOutgoing,
    backEdges,
    flowNodeDocumentIndex
  );
  const selectEdge = (node, candidates, visited) => {
    return selectPrimaryEdge(node, candidates, edgeOrder, visited, outgoing);
  };
  const spine = new Set();
  const starts = records.filter(record => is(record.element, 'bpmn:StartEvent'))
    .sort((a, b) => a.index - b.index);
  const incomingNodes = new Set(graphEdges.map(edge => edge.targetRef));
  const sourceNodes = records.filter(record => !incomingNodes.has(record.element))
    .map(record => record.element);
  const primarySeed = starts[0]?.element ||
    sourceNodes[0] ||
    records[0]?.element;
  const adHocSources = is(scope, 'bpmn:AdHocSubProcess') ? sourceNodes : [];
  const seeds = [
    primarySeed,
    ...adHocSources,
    ...records.filter(record => {
      return is(record.element, 'bpmn:IntermediateCatchEvent') &&
        (record.element.eventDefinitions || []).some(definition => {
          return is(definition, 'bpmn:LinkEventDefinition');
        });
    }).map(record => record.element)
  ];
  const visited = new Set();
  const claimed = new Set();
  const components = new Map();
  const adjacent = new Map(records.map(record => [ record.element, [] ]));
  let componentIndex = 0;

  for (const edge of graphEdges) {
    adjacent.get(edge.sourceRef).push(edge.targetRef);
    adjacent.get(edge.targetRef).push(edge.sourceRef);
  }
  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;

    adjacent.get(host).push(edge.targetRef);
    adjacent.get(edge.targetRef).push(host);
  }

  for (const seed of records.map(record => record.element)) {
    if (claimed.has(seed)) {
      continue;
    }

    const componentQueue = [ seed ];
    claimed.add(seed);
    components.set(seed, componentIndex);

    while (componentQueue.length) {
      const element = componentQueue.shift();

      for (const neighbor of adjacent.get(element)) {
        if (!claimed.has(neighbor)) {
          claimed.add(neighbor);
          components.set(neighbor, componentIndex);
          componentQueue.push(neighbor);
        }
      }
    }

    componentIndex++;
  }

  const mainComponent = components.get(primarySeed);
  const componentSeeds = new Map();

  for (const record of starts) {
    const component = components.get(record.element);

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
      const next = selectEdge(current, candidates, visited);

      if (!next) {
        break;
      }

      spine.add(next);
      current = next.targetRef;
    }
  }

  const straightEdges = new Set(spine);

  for (const record of records) {
    const candidates = outgoing.get(record.element) || [];

    if (is(record.element, 'bpmn:Gateway') && candidates.length > 1) {
      straightEdges.add(selectEdge(record.element, candidates, new Set()));
    }
  }

  const straightTargets = [ ...straightEdges ].map(edge => edge.targetRef);

  while (straightTargets.length) {
    const node = straightTargets.shift();
    const candidates = outgoing.get(node) || [];

    if (candidates.length !== 1 || straightEdges.has(candidates[0])) {
      continue;
    }

    straightEdges.add(candidates[0]);
    straightTargets.push(candidates[0].targetRef);
  }

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
    backEdges
  };
}

function findCompactFlowRegions(records, graphEdges, outgoing, edgeOrder) {
  const incomingCount = new Map(records.map(record => [ record.element, 0 ]));

  for (const edge of graphEdges) {
    incomingCount.set(edge.targetRef, incomingCount.get(edge.targetRef) + 1);
  }

  const regions = [];

  for (const record of records) {
    const split = record.element;
    const branches = outgoing.get(split) || [];

    if (branches.length < 2) {
      continue;
    }

    const distances = branches.map(branch => {
      return descendantDistances(branch.targetRef, outgoing, split);
    });
    const common = [ ...distances[0].keys() ].filter(node => {
      return node !== split &&
        incomingCount.get(node) > 1 &&
        distances.every(distance => distance.has(node));
    });

    if (!common.length) {
      continue;
    }

    const join = common.sort((a, b) => {
      const distancesA = distances.map(distance => distance.get(a));
      const distancesB = distances.map(distance => distance.get(b));

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

function descendantDistances(start, outgoing, blocked) {
  const distances = new Map([ [ start, 0 ] ]);
  const pending = [ start ];

  while (pending.length) {
    const node = pending.shift();

    for (const edge of outgoing.get(node) || []) {
      const target = edge.targetRef;

      if (target === blocked || distances.has(target)) {
        continue;
      }

      distances.set(target, distances.get(node) + 1);
      pending.push(target);
    }
  }

  return distances;
}

function shortestFlowPath(start, target, outgoing, edgeOrder, blocked) {
  if (start === target) {
    return [];
  }

  const pending = [ start ];
  const previous = new Map();
  const visited = new Set([ start, blocked ]);

  while (pending.length) {
    const node = pending.shift();
    const edges = [ ...(outgoing.get(node) || []) ]
      .sort((a, b) => edgeOrder.get(a) - edgeOrder.get(b));

    for (const edge of edges) {
      if (visited.has(edge.targetRef)) {
        continue;
      }

      visited.add(edge.targetRef);
      previous.set(edge.targetRef, edge);

      if (edge.targetRef === target) {
        const path = [];

        for (let current = target; current !== start;) {
          const previousEdge = previous.get(current);

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

function indexOfNode(node, records) {
  return records.find(record => record.element === node)?.index ?? Infinity;
}

function createCompactRankWeights(regions) {
  const weights = new Map();

  for (const { paths, primaryPath } of regions) {
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

function alignLinkEventContinuationBands(records, graphEdges, bands) {
  const links = new Map();
  const outgoing = new Map(records.map(record => [ record.element, [] ]));
  const incomingCount = new Map(records.map(record => [ record.element, 0 ]));

  for (const edge of graphEdges) {
    outgoing.get(edge.sourceRef).push(edge);
    incomingCount.set(edge.targetRef, incomingCount.get(edge.targetRef) + 1);
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
      links.get(name).throwEvent = record.element;
    } else if (is(record.element, 'bpmn:IntermediateCatchEvent')) {
      links.get(name).catchEvent = record.element;
    }
  }

  for (const { throwEvent, catchEvent } of links.values()) {
    if (!throwEvent || !catchEvent) {
      continue;
    }

    const offset = (bands.get(throwEvent) || 0) - (bands.get(catchEvent) || 0);
    const pending = [ catchEvent ];
    const visited = new Set();

    while (pending.length) {
      const element = pending.shift();

      if (visited.has(element)) {
        continue;
      }

      visited.add(element);
      bands.set(element, (bands.get(element) || 0) + offset);

      for (const edge of outgoing.get(element) || []) {
        if (incomingCount.get(edge.targetRef) <= 1) {
          pending.push(edge.targetRef);
        }
      }
    }
  }
}

function assignBoundaryBandOffsets(boundaryEdges, flowNodeDocumentIndex) {
  const edgesByHost = new Map();

  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;
    const side = hasEventDefinition(edge.sourceRef, 'bpmn:EscalationEventDefinition')
      ? 'top'
      : 'bottom';

    if (!edgesByHost.has(host)) {
      edgesByHost.set(host, { top: new Map(), bottom: new Map() });
    }

    const edgesByEvent = edgesByHost.get(host)[side];

    if (!edgesByEvent.has(edge.sourceRef)) {
      edgesByEvent.set(edge.sourceRef, []);
    }

    edgesByEvent.get(edge.sourceRef).push(edge);
  }

  const assigned = new Map();

  for (const [ , sides ] of edgesByHost) {
    for (const [ side, edgesByEvent ] of Object.entries(sides)) {
      let offset = 1;
      const direction = side === 'top' ? -1 : 1;
      const eventGroups = [ ...edgesByEvent.entries() ]
        .sort(([ eventA ], [ eventB ]) => flowNodeDocumentIndex.get(eventB) - flowNodeDocumentIndex.get(eventA))
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
    records,
    graphEdges,
    boundaryEdges,
    straightEdges,
    flowNodeDocumentIndex,
    allElementsDocumentIndex,
    edgeIndex,
    components,
    backEdges) {
  const nodes = records.map(record => record.element);
  const outgoing = new Map(nodes.map(node => [ node, [] ]));
  const incomingCount = new Map(nodes.map(node => [ node, 0 ]));

  for (const edge of graphEdges) {
    outgoing.get(edge.sourceRef).push(edge);
  }

  for (const edge of graphEdges) {
    if (!backEdges.has(edge)) {
      incomingCount.set(edge.targetRef, incomingCount.get(edge.targetRef) + 1);
    }
  }

  const bands = new Map(nodes.map(node => [ node, 0 ]));
  const occupied = new Map();
  const visited = new Set();
  const reserveBand = (component, base, offset) => {
    if (!occupied.has(component)) {
      occupied.set(component, new Set([ 0 ]));
    }

    const used = occupied.get(component);
    const direction = Math.sign(offset);
    let candidate = base + offset;

    while (used.has(candidate)) {
      candidate += direction;
    }

    used.add(candidate);
    return candidate;
  };
  const visit = (node, band, component = components.get(node)) => {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    bands.set(node, band);

    if (!occupied.has(component)) {
      occupied.set(component, new Set());
    }
    occupied.get(component).add(band);

    const candidates = (outgoing.get(node) || [])
      .filter(edge => !backEdges.has(edge))
      .sort((a, b) => edgeIndex.get(a) - edgeIndex.get(b));
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
  const boundaryTargets = new Set(boundaryEdges.map(edge => edge.targetRef));
  const sources = records
    .filter(record => incomingCount.get(record.element) === 0 && !boundaryTargets.has(record.element))
    .sort((a, b) => a.index - b.index);

  for (const record of sources) {
    visit(record.element, 0);
  }

  const boundaryOffsets = assignBoundaryBandOffsets(boundaryEdges, allElementsDocumentIndex);

  for (const edge of [ ...boundaryEdges ].sort((a, b) => edgeIndex.get(a) - edgeIndex.get(b))) {
    if (visited.has(edge.targetRef)) {
      continue;
    }

    const host = edge.sourceRef.attachedToRef;
    const component = components.get(host);
    const hostBand = bands.get(host) || 0;

    visit(
      edge.targetRef,
      reserveBand(component, hostBand, boundaryOffsets.get(edge)),
      component
    );
  }

  for (const record of [ ...records ].sort((a, b) => a.index - b.index)) {
    visit(record.element, 0);
  }

  return bands;
}

function selectPrimaryEdge(
    node,
    edges,
    edgeOrder,
    visited = new Set(),
    outgoing = new Map()) {
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
    [ ...preferred ].sort((a, b) => edgeOrder.get(a) - edgeOrder.get(b))[0];
}

function canReachEndEvent(node, outgoing, path) {
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

function branchOffset(index, oneSided = false) {
  if (oneSided) {
    return index + 1;
  }

  const distance = Math.floor(index / 2) + 1;

  return index % 2 === 0 ? distance : -distance;
}

export function assignRanks(records, graphEdges, boundaryEdges, policy) {
  const rank = new Map(records.map(record => [ record.element, 0 ]));
  const outgoing = new Map(records.map(record => [ record.element, [] ]));
  const indegree = new Map(records.map(record => [ record.element, 0 ]));
  const backEdges = policy.backEdges;

  for (const edge of graphEdges) {
    outgoing.get(edge.sourceRef).push(edge);
  }

  for (const edge of graphEdges) {
    if (!backEdges.has(edge)) {
      indegree.set(edge.targetRef, indegree.get(edge.targetRef) + 1);
    }
  }

  const ready = records.filter(record => indegree.get(record.element) === 0)
    .sort((a, b) => a.index - b.index);
  const processed = new Set();

  while (ready.length) {
    const record = ready.shift();
    const source = record.element;

    if (processed.has(source)) {
      continue;
    }

    processed.add(source);

    for (const edge of outgoing.get(source)) {
      if (backEdges.has(edge)) {
        continue;
      }

      const weight = policy.rankWeights.get(edge) ?? 1;

      rank.set(
        edge.targetRef,
        Math.max(rank.get(edge.targetRef), rank.get(source) + weight)
      );
      indegree.set(edge.targetRef, indegree.get(edge.targetRef) - 1);

      if (indegree.get(edge.targetRef) === 0) {
        ready.push(records.find(candidate => candidate.element === edge.targetRef));
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
      backEdges
    );

    if (!changed) {
      break;
    }

    stabilizeRanks(rank, graphEdges, boundaryEdges, policy, records.length);
  }

  return { rank, backEdges };
}

function reserveGatewayBranchSpans(rank, outgoing, spine, backEdges) {
  const spineNodes = new Set();

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
    let reservedUntil = rank.get(spineEdge.targetRef);

    for (const branch of branches) {
      const branchEnd = findDetachedBranchEnd(
        branch,
        rank,
        outgoing,
        spineNodes,
        backEdges
      );

      if (branchEnd !== null) {
        reservedUntil = Math.max(reservedUntil, branchEnd + 1);
      }
    }

    rank.set(spineEdge.targetRef, reservedUntil);
  }
}

function stabilizeRanks(rank, graphEdges, boundaryEdges, policy, maxIterations) {
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

      const candidate = rank.get(edge.sourceRef) + (policy.rankWeights.get(edge) ?? 1);

      if (candidate > rank.get(edge.targetRef)) {
        rank.set(edge.targetRef, candidate);
        changed = true;
      }

    }

    for (const edge of boundaryEdges) {
      if (backEdges.has(edge)) {
        continue;
      }

      const hostRank = rank.get(edge.sourceRef.attachedToRef);
      const candidate = hostRank + 1;

      if (candidate > rank.get(edge.targetRef)) {
        rank.set(edge.targetRef, candidate);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }
}

function reserveDetachedBranchSpans(rank, outgoing, boundaryEdges, spine, backEdges) {
  const spineNodes = new Set();
  const boundaryBranches = new Map();
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
    boundaryBranches.get(host).push(edge);
  }

  for (const spineEdge of spine) {
    const continuationBranches = [
      ...(outgoing.get(spineEdge.targetRef) || []),
      ...(boundaryBranches.get(spineEdge.targetRef) || [])
    ].filter(edge => !backEdges.has(edge));

    if (continuationBranches.length < 2) {
      continue;
    }

    const branches = [
      ...(outgoing.get(spineEdge.sourceRef) || []).filter(edge => edge !== spineEdge),
      ...(boundaryBranches.get(spineEdge.sourceRef) || [])
    ].filter(edge => !backEdges.has(edge));
    const sourceRank = rank.get(spineEdge.sourceRef);
    let reservedUntil = rank.get(spineEdge.targetRef);

    for (const branch of branches) {
      const branchEnd = findDetachedBranchEnd(
        branch,
        rank,
        outgoing,
        spineNodes,
        backEdges,
        sourceRank
      );

      if (branchEnd !== null) {
        reservedUntil = Math.max(reservedUntil, branchEnd + 1);
      }
    }

    if (reservedUntil > rank.get(spineEdge.targetRef)) {
      rank.set(spineEdge.targetRef, reservedUntil);
      changed = true;
    }
  }

  return changed;
}

function findDetachedBranchEnd(
    branch,
    rank,
    outgoing,
    spineNodes,
    backEdges,
    sourceRank = null) {
  const pending = [ { node: branch.targetRef, distance: 1 } ];
  const visited = new Set();
  let detached = true;
  let cyclic = false;
  let branchEnd = sourceRank === null
    ? rank.get(branch.targetRef)
    : sourceRank + 1;

  while (pending.length) {
    const { node, distance } = pending.shift();

    if (visited.has(node)) {
      continue;
    }

    visited.add(node);
    branchEnd = Math.max(branchEnd, rank.get(node));

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

function markBackEdges(nodes, outgoing, backEdges, flowNodeDocumentIndex) {
  const state = new Map();
  const incomingCount = new Map(nodes.map(node => [ node, 0 ]));

  for (const edges of outgoing.values()) {
    for (const edge of edges) {
      incomingCount.set(edge.targetRef, incomingCount.get(edge.targetRef) + 1);
    }
  }

  function visit(node) {
    state.set(node, 'visiting');
    const edges = [ ...(outgoing.get(node) || []) ].sort((a, b) => flowNodeDocumentIndex.get(a.targetRef) - flowNodeDocumentIndex.get(b.targetRef));

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

    return flowNodeDocumentIndex.get(a) - flowNodeDocumentIndex.get(b);
  });

  for (const node of ordered) {
    if (!state.has(node)) {
      visit(node);
    }
  }
}

export function edgePriority(edge, policy) {
  if (policy.spine?.has(edge)) {
    return EDGE_PRIORITY.SPINE;
  }

  if (policy.straightEdges?.has(edge)) {
    return EDGE_PRIORITY.STRAIGHT;
  }

  const sourceBand = policy.bands?.get(edge.sourceRef) || 0;
  const targetBand = policy.bands?.get(edge.targetRef) || 0;
  const crossBandGatewayBranch = is(edge.sourceRef, 'bpmn:Gateway') &&
    (edge.sourceRef.outgoing || []).length > 1 &&
    sourceBand !== targetBand;

  if (!policy.backEdges?.has(edge) && crossBandGatewayBranch) {
    return EDGE_PRIORITY.CROSS_BAND_GATEWAY_BRANCH;
  }

  if (policy.backEdges?.has(edge)) {
    return EDGE_PRIORITY.BACK_EDGE;
  }

  return EDGE_PRIORITY.STANDARD;
}
