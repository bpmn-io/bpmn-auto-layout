export function compactSemanticBands(
    records,
    graphEdges,
    boundaryEdges,
    ranks,
    policy) {
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
    records,
    graphEdges,
    boundaryEdges,
    ranks,
    policy) {
  const intervals = new Map();
  const outgoingCount = new Map(
    records.map(record => [ record.element, 0 ])
  );

  for (const edge of graphEdges) {
    outgoingCount.set(
      edge.sourceRef,
      outgoingCount.get(edge.sourceRef) + 1
    );
  }

  for (const record of records) {
    const element = record.element;
    const rank = ranks.rank.get(element);

    addBandInterval(
      intervals,
      policy.components.get(element),
      policy.bands.get(element) || 0,
      rank,
      rank
    );
  }

  for (const edge of graphEdges) {
    if (policy.backEdges.has(edge)) {
      continue;
    }

    const sourceRank = ranks.rank.get(edge.sourceRef);
    const targetRank = ranks.rank.get(edge.targetRef);
    const min = Math.min(sourceRank, targetRank);
    const max = Math.max(sourceRank, targetRank);
    const sourceBand = policy.bands.get(edge.sourceRef) || 0;
    const targetBand = policy.bands.get(edge.targetRef) || 0;
    const occupiedBand = sourceBand === targetBand
      ? sourceBand
      : outgoingCount.get(edge.sourceRef) > 1
        ? targetBand
        : sourceBand;

    addBandInterval(
      intervals,
      policy.components.get(edge.sourceRef),
      occupiedBand,
      min,
      max
    );
  }

  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;
    const sourceRank = ranks.rank.get(host);
    const targetRank = ranks.rank.get(edge.targetRef);

    addBandInterval(
      intervals,
      policy.components.get(host),
      policy.bands.get(edge.targetRef) || 0,
      Math.min(sourceRank, targetRank),
      Math.max(sourceRank, targetRank),
      policy.boundaryBayEdges.has(edge)
    );
  }

  return intervals;
}

function addBandInterval(
    intervals,
    component,
    band,
    min,
    max,
    boundary = false) {
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

function collectBoundaryHostBands(boundaryEdges, policy) {
  const boundaryHosts = new Map();

  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;
    const component = policy.components.get(host);
    const targetBand = policy.bands.get(edge.targetRef) || 0;
    const key = `${component}:${targetBand}`;

    if (!boundaryHosts.has(key)) {
      boundaryHosts.set(key, []);
    }

    boundaryHosts.get(key).push(policy.bands.get(host) || 0);
  }

  return boundaryHosts;
}

function assignCompactedBands(intervals, boundaryHosts) {
  const assigned = new Map();
  const mapping = new Map();
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
    interval,
    boundaryHosts,
    mapping,
    direction) {
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

function bandOverlaps(interval, assigned, compacted) {
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

function applyCompactedBands(records, policy, mapping) {
  for (const record of records) {
    const element = record.element;
    const band = policy.bands.get(element) || 0;

    if (band) {
      policy.bands.set(
        element,
        mapping.get(`${policy.components.get(element)}:${band}`)
      );
    }
  }
}
