import { is } from '../di/DiUtil.js';
import { LayoutError } from '../LayoutError.js';
import { HORIZONTAL_GAP, VERTICAL_GAP, ROUTING_MARGIN, LANE_CONTENT_PADDING, SEMANTIC_BAND_HEIGHT, MIN_LANE_CONTENT_WIDTH, MIN_LANE_HEIGHT, BOUNDARY_EVENT_SPACING } from './Constants.js';
import { hasEventDefinition } from './BpmnUtil.js';
import { bounds, rectanglesOverlap, getRecordExtents } from './LayoutUtil.js';

export function placeRecords(records, ranks, policy) {
  const byRank = new Map();

  for (const record of records) {
    const rank = ranks.rank.get(record.element) || 0;
    record.rank = rank;

    if (!byRank.has(rank)) {
      byRank.set(rank, []);
    }

    byRank.get(rank).push(record);
  }

  const rankNumbers = [ ...byRank.keys() ].sort((a, b) => a - b);
  const rankWidths = new Map();
  let x = 0;

  for (const rank of rankNumbers) {
    const width = Math.max(...byRank.get(rank).map(record => record.size.width));
    rankWidths.set(rank, width);

    for (const record of byRank.get(rank)) {
      record.bounds = bounds(
        x + Math.round((width - record.size.width) / 2),
        (policy.bands.get(record.element) || 0) * (VERTICAL_GAP + SEMANTIC_BAND_HEIGHT) - record.size.height / 2,
        record.size.width,
        record.size.height
      );
    }

    x += width + HORIZONTAL_GAP;
  }

  for (const rank of rankNumbers) {
    const occupied = new Map();

    for (const record of byRank.get(rank).sort((a, b) => a.index - b.index)) {
      const band = policy.bands.get(record.element) || 0;
      const key = `${policy.components.get(record.element)}:${band}`;
      const offset = occupied.get(key) || 0;
      record.bounds.y += offset;
      occupied.set(key, offset + record.size.height + VERTICAL_GAP);
    }
  }

}

export function clearBoundaryHandlerExits(records, boundaryEdges, recordsByElement, policy) {
  const ordered = [ ...boundaryEdges ].sort((a, b) => {
    const bandA = policy.bands.get(a.targetRef) || 0;
    const bandB = policy.bands.get(b.targetRef) || 0;

    return Math.abs(bandA) - Math.abs(bandB);
  });

  for (const edge of ordered) {
    const boundary = recordsByElement.get(edge.sourceRef);
    const host = recordsByElement.get(edge.sourceRef.attachedToRef);
    const target = recordsByElement.get(edge.targetRef);
    const targetBand = policy.bands.get(edge.targetRef) || 0;
    const hostBand = policy.bands.get(edge.sourceRef.attachedToRef) || 0;
    const component = policy.components.get(edge.targetRef);

    if (targetBand === hostBand) {
      continue;
    }

    const exitsTop = hasEventDefinition(
      edge.sourceRef,
      'bpmn:EscalationEventDefinition'
    );
    const boundaryExitY = exitsTop
      ? host.bounds.y - boundary.size.height / 2
      : host.bounds.y + host.bounds.height + boundary.size.height / 2;
    const targetCenterY = target.bounds.y + target.bounds.height / 2;
    const requiredCenterY = boundaryExitY +
      (exitsTop ? -ROUTING_MARGIN : ROUTING_MARGIN);
    const shift = exitsTop
      ? Math.min(0, requiredCenterY - targetCenterY)
      : Math.max(0, requiredCenterY - targetCenterY);

    if (!shift) {
      continue;
    }

    for (const record of records) {
      const band = policy.bands.get(record.element) || 0;
      const sameSideOrFurther = exitsTop
        ? band <= targetBand
        : band >= targetBand;

      if (
        policy.components.get(record.element) === component &&
        sameSideOrFurther
      ) {
        record.bounds.y += shift;
      }
    }
  }
}

export function compactSemanticBands(records, graphEdges, boundaryEdges, ranks, policy) {
  const intervals = new Map();
  const outgoingCount = new Map(records.map(record => [ record.element, 0 ]));
  const addInterval = (component, band, min, max) => {
    if (!band) {
      return;
    }

    const key = `${component}:${band}`;
    const existing = intervals.get(key);

    if (existing) {
      existing.spans.push({ min, max });
    } else {
      intervals.set(key, {
        component,
        band,
        spans: [ { min, max } ]
      });
    }
  };

  for (const edge of graphEdges) {
    outgoingCount.set(edge.sourceRef, outgoingCount.get(edge.sourceRef) + 1);
  }

  for (const record of records) {
    const element = record.element;
    const rank = ranks.rank.get(element);

    addInterval(
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

    addInterval(
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

    addInterval(
      policy.components.get(host),
      policy.bands.get(edge.targetRef) || 0,
      Math.min(sourceRank, targetRank),
      Math.max(sourceRank, targetRank)
    );
  }

  const assigned = new Map();
  const mapping = new Map();
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

  const ordered = [ ...intervals.values() ].sort((a, b) => {
    return a.component - b.component ||
      Math.sign(a.band) - Math.sign(b.band) ||
      Math.abs(a.band) - Math.abs(b.band);
  });

  for (const interval of ordered) {
    const direction = Math.sign(interval.band);
    const hostBands = boundaryHosts.get(`${interval.component}:${interval.band}`) || [];
    const minimumMagnitude = hostBands.reduce((minimum, hostBand) => {
      if (Math.sign(hostBand) !== direction) {
        return minimum;
      }

      const compactedHost = mapping.get(`${interval.component}:${hostBand}`) || hostBand;

      return Math.max(minimum, Math.abs(compactedHost) + 1);
    }, 1);
    let compacted = direction * minimumMagnitude;
    let placed = false;

    while (!placed) {
      const key = `${interval.component}:${compacted}`;
      const occupied = assigned.get(key) || [];
      const overlaps = occupied.some(existing => {
        return interval.spans.some(span => {
          return existing.spans.some(other => {
            return span.min <= other.max && span.max >= other.min;
          });
        });
      });

      if (!overlaps) {
        occupied.push(interval);
        assigned.set(key, occupied);
        mapping.set(`${interval.component}:${interval.band}`, compacted);
        placed = true;
        continue;
      }

      compacted += direction;
    }
  }

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

export function packComponents(scope, records, graphEdges, boundaryEdges) {
  const parent = new Map(records.map(record => [ record.element, record.element ]));
  const find = element => {
    const root = parent.get(element);

    if (root === element) {
      return root;
    }

    const compressed = find(root);
    parent.set(element, compressed);
    return compressed;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);

    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  for (const edge of [ ...graphEdges, ...boundaryEdges ]) {
    const source = is(edge.sourceRef, 'bpmn:BoundaryEvent')
      ? edge.sourceRef.attachedToRef
      : edge.sourceRef;

    if (parent.has(source) && parent.has(edge.targetRef)) {
      union(source, edge.targetRef);
    }
  }

  const components = new Map();

  for (const record of records) {
    const root = find(record.element);

    if (!components.has(root)) {
      components.set(root, []);
    }

    components.get(root).push(record);
  }

  const ordered = [ ...components.values() ].sort((a, b) => {
    return Math.min(...a.map(record => record.index)) - Math.min(...b.map(record => record.index));
  });

  for (const component of ordered) {
    separateRankOverlaps(component);
  }

  if (is(scope, 'bpmn:AdHocSubProcess')) {
    packCompactComponents(ordered);
    return;
  }

  let y = 0;

  for (const component of ordered) {
    const extents = getRecordExtents(component);
    const dx = -extents.minX;
    const dy = y - extents.minY;

    for (const record of component) {
      record.bounds.x += dx;
      record.bounds.y += dy;
    }

    y += extents.height + 2 * VERTICAL_GAP;
  }
}

function packCompactComponents(components) {
  const items = components.map(component => {
    const extents = getRecordExtents(component);

    return {
      component,
      extents,
      index: Math.min(...component.map(record => record.index)),
      width: extents.width,
      height: extents.height
    };
  }).sort((a, b) => {
    return b.height - a.height ||
      b.width - a.width ||
      a.index - b.index;
  });
  const totalArea = items.reduce((sum, item) => {
    return sum +
      (item.width + HORIZONTAL_GAP) *
      (item.height + VERTICAL_GAP);
  }, 0);
  const packingWidth = Math.max(
    ...items.map(item => item.width),
    Math.ceil(Math.sqrt(totalArea))
  );
  const placed = [];

  for (const item of items) {
    const xs = [ 0, ...placed.map(candidate => candidate.x + candidate.width + HORIZONTAL_GAP) ];
    const ys = [ 0, ...placed.map(candidate => candidate.y + candidate.height + VERTICAL_GAP) ];
    let placement = null;

    for (const y of [ ...new Set(ys) ].sort((a, b) => a - b)) {
      for (const x of [ ...new Set(xs) ].sort((a, b) => a - b)) {
        const candidate = bounds(x, y, item.width, item.height);

        if (x + item.width > packingWidth) {
          continue;
        }
        if (placed.some(other => rectanglesOverlapWithGap(candidate, other))) {
          continue;
        }

        placement = candidate;
        break;
      }

      if (placement) {
        break;
      }
    }

    if (!placement) {
      const y = placed.length
        ? Math.max(...placed.map(candidate => candidate.y + candidate.height)) + VERTICAL_GAP
        : 0;

      placement = bounds(0, y, item.width, item.height);
    }

    const dx = placement.x - item.extents.minX;
    const dy = placement.y - item.extents.minY;

    for (const record of item.component) {
      record.bounds.x += dx;
      record.bounds.y += dy;
    }

    placed.push(placement);
  }
}

function rectanglesOverlapWithGap(a, b) {
  return a.x < b.x + b.width + HORIZONTAL_GAP &&
    a.x + a.width + HORIZONTAL_GAP > b.x &&
    a.y < b.y + b.height + VERTICAL_GAP &&
    a.y + a.height + VERTICAL_GAP > b.y;
}

function separateRankOverlaps(records) {
  const byRank = new Map();

  for (const record of records) {
    if (!byRank.has(record.rank)) {
      byRank.set(record.rank, []);
    }

    byRank.get(record.rank).push(record);
  }

  for (const rankRecords of byRank.values()) {
    const placed = [];

    for (const record of rankRecords.sort((a, b) => a.index - b.index)) {
      let blockers;

      while ((blockers = placed.filter(other => rectanglesOverlap(record.bounds, other.bounds))).length) {
        record.bounds.y = Math.max(
          record.bounds.y,
          ...blockers.map(other => other.bounds.y + other.bounds.height + VERTICAL_GAP)
        );
      }

      placed.push(record);
    }
  }
}

export function applyLaneMembership(scope, records, graphEdges, policy, layout) {
  const lanes = flattenLanes(scope.laneSets || []);

  if (!lanes.length) {
    return;
  }

  const memberships = new Map();

  for (const lane of lanes) {
    for (const node of lane.flowNodeRef || []) {
      if (!memberships.has(node)) {
        memberships.set(node, []);
      }

      memberships.get(node).push(lane);
    }
  }

  for (const [ node, nodeLanes ] of memberships) {
    const deepest = nodeLanes.filter(lane => {
      return !nodeLanes.some(other => other !== lane && laneContains(lane, other));
    });

    if (deepest.length !== 1) {
      throw new LayoutError(
        'INVALID_LANE_MEMBERSHIP',
        node.id,
        'A flow node must have one deepest lane membership.',
        deepest.map(lane => lane.id)
      );
    }

    memberships.set(node, deepest);
  }

  const maxRight = Math.max(...records.map(record => record.bounds.x + record.bounds.width), MIN_LANE_CONTENT_WIDTH);

  for (const record of records) {
    record.bounds.x += LANE_CONTENT_PADDING;
  }

  const laneHeights = new Map();
  const rowsByLane = new Map();
  const recordByElement = new Map(records.map(record => [ record.element, record ]));
  const rowParents = new Map(records.map(record => [ record, record ]));
  const rowMembers = new Map(records.map(record => [ record, [ record ] ]));
  const findRow = record => {
    let root = record;

    while (rowParents.get(root) !== root) {
      root = rowParents.get(root);
    }

    while (rowParents.get(record) !== record) {
      const parent = rowParents.get(record);

      rowParents.set(record, root);
      record = parent;
    }

    return root;
  };
  const mergeRows = (a, b) => {
    const rootA = findRow(a);
    const rootB = findRow(b);

    if (rootA === rootB) {
      return;
    }

    const membersA = rowMembers.get(rootA);
    const membersB = rowMembers.get(rootB);
    const collides = membersA.some(recordA => {
      return membersB.some(recordB => {
        return recordA.bounds.x < recordB.bounds.x + recordB.bounds.width &&
          recordA.bounds.x + recordA.bounds.width > recordB.bounds.x;
      });
    });

    if (collides) {
      return;
    }

    rowParents.set(rootB, rootA);
    rowMembers.set(rootA, [ ...membersA, ...membersB ]);
    rowMembers.delete(rootB);
  };

  for (const lane of lanes) {
    const recordsByCenter = new Map();

    for (const record of records.filter(record => memberships.get(record.element)?.[0] === lane)) {
      const centerY = record.bounds.y + record.bounds.height / 2;
      const existing = recordsByCenter.get(centerY);

      if (existing) {
        mergeRows(existing, record);
      } else {
        recordsByCenter.set(centerY, record);
      }
    }
  }

  for (const edge of graphEdges) {
    const source = recordByElement.get(edge.sourceRef);
    const target = recordByElement.get(edge.targetRef);
    const sourceLane = memberships.get(edge.sourceRef)?.[0];
    const targetLane = memberships.get(edge.targetRef)?.[0];
    const linearContinuation =
      (edge.sourceRef.outgoing || []).filter(flow => is(flow, 'bpmn:SequenceFlow')).length === 1 &&
      (edge.targetRef.incoming || []).filter(flow => is(flow, 'bpmn:SequenceFlow')).length === 1;

    if (source && target && sourceLane && sourceLane === targetLane &&
        !policy.backEdges.has(edge) &&
        (policy.straightEdges.has(edge) || linearContinuation)) {
      mergeRows(source, target);
    }
  }

  const getLaneRows = lane => {
    if (rowsByLane.has(lane)) {
      return rowsByLane.get(lane);
    }

    const rows = new Map();
    const directRecords = records.filter(record => memberships.get(record.element)?.[0] === lane);

    for (const record of directRecords) {
      const root = findRow(record);

      if (!rows.has(root)) {
        rows.set(root, []);
      }

      rows.get(root).push(record);
    }

    const ordered = [ ...rows.values() ]
      .sort((rowA, rowB) => {
        const centerA = Math.min(...rowA.map(record => record.bounds.y + record.bounds.height / 2));
        const centerB = Math.min(...rowB.map(record => record.bounds.y + record.bounds.height / 2));

        return centerA - centerB;
      });

    rowsByLane.set(lane, ordered);
    return ordered;
  };
  const requiredLaneHeight = lane => {
    if (laneHeights.has(lane)) {
      return laneHeights.get(lane);
    }

    const rows = getLaneRows(lane);
    const directHeight = rows.length
      ? rows.reduce((total, row) => {
        return total + Math.max(...row.map(record => record.bounds.height));
      }, 0) + Math.max(0, rows.length - 1) * VERTICAL_GAP + 2 * VERTICAL_GAP
      : 0;
    const childrenHeight = (lane.childLaneSet?.lanes || []).reduce((total, child) => {
      return total + requiredLaneHeight(child);
    }, 0);
    const height = Math.max(MIN_LANE_HEIGHT, directHeight, childrenHeight);

    laneHeights.set(lane, height);
    return height;
  };

  let y = 0;

  for (const lane of lanes.filter(lane => !lanes.some(other => other !== lane && laneContains(other, lane)))) {
    const height = requiredLaneHeight(lane);

    addLaneLayout(lane, y, height, maxRight + 2 * LANE_CONTENT_PADDING, layout, laneHeights);
    y += height;
  }

  for (const lane of lanes) {
    const laneBounds = layout.shapes.get(lane);
    const rows = getLaneRows(lane);

    if (!laneBounds || !rows.length) {
      continue;
    }

    const totalHeight = rows.reduce((total, row) => {
      return total + Math.max(...row.map(record => record.bounds.height));
    }, 0) + Math.max(0, rows.length - 1) * VERTICAL_GAP;
    let recordY = laneBounds.y + Math.round((laneBounds.height - totalHeight) / 2);

    for (const row of rows) {
      const rowHeight = Math.max(...row.map(record => record.bounds.height));
      const centerY = recordY + rowHeight / 2;

      for (const record of row) {
        record.bounds.y = centerY - record.bounds.height / 2;
      }

      recordY += rowHeight + VERTICAL_GAP;
    }
  }
}

export function flattenLanes(laneSets) {
  const lanes = [];

  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      lanes.push(lane);
      lanes.push(...flattenLanes(lane.childLaneSet ? [ lane.childLaneSet ] : []));
    }
  }

  return lanes;
}

function laneContains(ancestor, candidate) {
  return flattenLanes(ancestor.childLaneSet ? [ ancestor.childLaneSet ] : []).includes(candidate);
}

function addLaneLayout(lane, y, height, width, layout, laneHeights) {
  layout.shapes.set(lane, bounds(0, y, width, height));

  const children = lane.childLaneSet?.lanes || [];

  if (!children.length) {
    return;
  }

  let childY = y;

  for (const child of children) {
    const childHeight = laneHeights.get(child);
    addLaneLayout(child, childY, childHeight, width, layout, laneHeights);
    childY += childHeight;
  }
}

export function placeBoundaryEvents(records, recordsByElement) {
  const boundaries = records.filter(record => record.isBoundary);
  const byHost = new Map();

  for (const record of boundaries) {
    const host = record.element.attachedToRef;

    if (!byHost.has(host)) {
      byHost.set(host, []);
    }

    byHost.get(host).push(record);
  }

  for (const [ host, attachers ] of byHost) {
    const hostRecord = recordsByElement.get(host);
    const hostBounds = hostRecord.bounds;
    const top = attachers.filter(record => hasEventDefinition(record.element, 'bpmn:EscalationEventDefinition'));
    const bottom = attachers.filter(record => !top.includes(record));

    placeAttachers(top, hostBounds, true, recordsByElement);
    placeAttachers(bottom, hostBounds, false, recordsByElement);
  }
}

function placeAttachers(records, hostBounds, onTop, recordsByElement) {
  const outward = onTop ? -1 : 1;

  records.sort((a, b) => {
    const aDistance = boundaryHandlerDistance(a, hostBounds, outward, recordsByElement);
    const bDistance = boundaryHandlerDistance(b, hostBounds, outward, recordsByElement);

    return bDistance - aDistance || a.index - b.index;
  }).forEach((record, index) => {
    const x = Math.round(hostBounds.x + hostBounds.width / 2 +
      (index - (records.length - 1) / 2) * (record.size.width + BOUNDARY_EVENT_SPACING) - record.size.width / 2);
    const y = onTop
      ? hostBounds.y - record.size.height / 2
      : hostBounds.y + hostBounds.height - record.size.height / 2;

    record.bounds = bounds(x, y, record.size.width, record.size.height);
  });
}

function boundaryHandlerDistance(record, hostBounds, outward, recordsByElement) {
  const targets = (record.element.outgoing || [])
    .map(flow => recordsByElement.get(flow.targetRef)?.bounds)
    .filter(Boolean);

  if (!targets.length) {
    return 0;
  }

  const targetCenterY = targets.reduce((sum, target) => {
    return sum + target.y + target.height / 2;
  }, 0) / targets.length;
  const hostSideY = onHostSide(hostBounds, outward);

  return outward * (targetCenterY - hostSideY);
}

function onHostSide(hostBounds, outward) {
  return outward < 0 ? hostBounds.y : hostBounds.y + hostBounds.height;
}
