import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';
import {
  LANE_CONTENT_PADDING,
  MIN_LANE_CONTENT_WIDTH,
  MIN_LANE_HEIGHT,
  VERTICAL_GAP
} from '../../Constants.js';
import { bounds } from '../../geometry/index.js';

export function applyLaneMembership(
    scope,
    records,
    graphEdges,
    policy,
    layout) {
  const lanes = flattenLanes(scope.laneSets || []);

  if (!lanes.length) {
    return;
  }

  const memberships = collectLaneMemberships(lanes);
  const laneWidth = prepareLaneContent(records);
  const rowsByLane = groupLaneRows(
    lanes,
    records,
    graphEdges,
    memberships,
    policy
  );
  const laneHeights = measureLaneHeights(lanes, rowsByLane);

  createLaneBounds(lanes, laneWidth, laneHeights, layout);
  positionLaneRows(lanes, rowsByLane, layout);
}

function collectLaneMemberships(lanes) {
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
      return !nodeLanes.some(other => {
        return other !== lane && laneContains(lane, other);
      });
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

  return memberships;
}

function prepareLaneContent(records) {
  const maxRight = Math.max(
    ...records.map(record => record.bounds.x + record.bounds.width),
    MIN_LANE_CONTENT_WIDTH
  );

  for (const record of records) {
    record.bounds.x += LANE_CONTENT_PADDING;
  }

  return maxRight + 2 * LANE_CONTENT_PADDING;
}

function groupLaneRows(lanes, records, graphEdges, memberships, policy) {
  const rowState = createLaneRowState(records);
  const recordByElement = new Map(
    records.map(record => [ record.element, record ])
  );

  mergeInitiallyAlignedRows(
    lanes,
    records,
    memberships,
    rowState
  );
  mergeStraightFlowRows(
    graphEdges,
    memberships,
    recordByElement,
    policy,
    rowState
  );

  return collectRowsByLane(lanes, records, memberships, rowState);
}

function createLaneRowState(records) {
  return {
    parents: new Map(records.map(record => [ record, record ])),
    members: new Map(records.map(record => [ record, [ record ] ]))
  };
}

function mergeInitiallyAlignedRows(lanes, records, memberships, rowState) {
  for (const lane of lanes) {
    const recordsByCenter = new Map();

    for (const record of records.filter(candidate => {
      return memberships.get(candidate.element)?.[0] === lane;
    })) {
      const centerY = record.bounds.y + record.bounds.height / 2;
      const existing = recordsByCenter.get(centerY);

      if (existing) {
        mergeLaneRows(rowState, existing, record);
      } else {
        recordsByCenter.set(centerY, record);
      }
    }
  }
}

function mergeStraightFlowRows(
    graphEdges,
    memberships,
    recordByElement,
    policy,
    rowState) {
  for (const edge of graphEdges) {
    const source = recordByElement.get(edge.sourceRef);
    const target = recordByElement.get(edge.targetRef);
    const sourceLane = memberships.get(edge.sourceRef)?.[0];
    const targetLane = memberships.get(edge.targetRef)?.[0];
    const linearContinuation =
      (edge.sourceRef.outgoing || [])
        .filter(flow => is(flow, 'bpmn:SequenceFlow')).length === 1 &&
      (edge.targetRef.incoming || [])
        .filter(flow => is(flow, 'bpmn:SequenceFlow')).length === 1;

    if (
      source &&
      target &&
      sourceLane &&
      sourceLane === targetLane &&
      !policy.backEdges.has(edge) &&
      (policy.straightEdges.has(edge) || linearContinuation)
    ) {
      mergeLaneRows(rowState, source, target);
    }
  }
}

function mergeLaneRows(rowState, a, b) {
  const rootA = findLaneRow(rowState.parents, a);
  const rootB = findLaneRow(rowState.parents, b);

  if (rootA === rootB) {
    return;
  }

  const membersA = rowState.members.get(rootA);
  const membersB = rowState.members.get(rootB);
  const collides = membersA.some(recordA => {
    return membersB.some(recordB => {
      return recordA.bounds.x < recordB.bounds.x + recordB.bounds.width &&
        recordA.bounds.x + recordA.bounds.width > recordB.bounds.x;
    });
  });

  if (collides) {
    return;
  }

  rowState.parents.set(rootB, rootA);
  rowState.members.set(rootA, [ ...membersA, ...membersB ]);
  rowState.members.delete(rootB);
}

function findLaneRow(parents, record) {
  let root = record;

  while (parents.get(root) !== root) {
    root = parents.get(root);
  }

  while (parents.get(record) !== record) {
    const parent = parents.get(record);

    parents.set(record, root);
    record = parent;
  }

  return root;
}

function collectRowsByLane(lanes, records, memberships, rowState) {
  const rowsByLane = new Map();

  for (const lane of lanes) {
    const rows = new Map();
    const directRecords = records.filter(record => {
      return memberships.get(record.element)?.[0] === lane;
    });

    for (const record of directRecords) {
      const root = findLaneRow(rowState.parents, record);

      if (!rows.has(root)) {
        rows.set(root, []);
      }

      rows.get(root).push(record);
    }

    rowsByLane.set(
      lane,
      [ ...rows.values() ].sort((rowA, rowB) => {
        const centerA = Math.min(...rowA.map(record => {
          return record.bounds.y + record.bounds.height / 2;
        }));
        const centerB = Math.min(...rowB.map(record => {
          return record.bounds.y + record.bounds.height / 2;
        }));

        return centerA - centerB;
      })
    );
  }

  return rowsByLane;
}

function measureLaneHeights(lanes, rowsByLane) {
  const laneHeights = new Map();

  for (const lane of topLevelLanes(lanes)) {
    requiredLaneHeight(lane, rowsByLane, laneHeights);
  }

  return laneHeights;
}

function requiredLaneHeight(lane, rowsByLane, laneHeights) {
  if (laneHeights.has(lane)) {
    return laneHeights.get(lane);
  }

  const rows = rowsByLane.get(lane) || [];
  const directHeight = rows.length
    ? rows.reduce((total, row) => {
      return total + Math.max(...row.map(record => record.bounds.height));
    }, 0) + Math.max(0, rows.length - 1) * VERTICAL_GAP + 2 * VERTICAL_GAP
    : 0;
  const childrenHeight = (lane.childLaneSet?.lanes || []).reduce((
      total,
      child
  ) => {
    return total + requiredLaneHeight(child, rowsByLane, laneHeights);
  }, 0);
  const height = Math.max(MIN_LANE_HEIGHT, directHeight, childrenHeight);

  laneHeights.set(lane, height);
  return height;
}

function createLaneBounds(lanes, width, laneHeights, layout) {
  let y = 0;

  for (const lane of topLevelLanes(lanes)) {
    const height = laneHeights.get(lane);

    addLaneLayout(lane, y, height, width, layout, laneHeights);
    y += height;
  }
}

function positionLaneRows(lanes, rowsByLane, layout) {
  for (const lane of lanes) {
    const laneBounds = layout.shapes.get(lane);
    const rows = rowsByLane.get(lane) || [];

    if (!laneBounds || !rows.length) {
      continue;
    }

    const totalHeight = rows.reduce((total, row) => {
      return total + Math.max(...row.map(record => record.bounds.height));
    }, 0) + Math.max(0, rows.length - 1) * VERTICAL_GAP;
    let recordY = laneBounds.y +
      Math.round((laneBounds.height - totalHeight) / 2);

    for (const row of rows) {
      const rowHeight = Math.max(
        ...row.map(record => record.bounds.height)
      );
      const centerY = recordY + rowHeight / 2;

      for (const record of row) {
        record.bounds.y = centerY - record.bounds.height / 2;
      }

      recordY += rowHeight + VERTICAL_GAP;
    }
  }
}

function topLevelLanes(lanes) {
  return lanes.filter(lane => {
    return !lanes.some(other => {
      return other !== lane && laneContains(other, lane);
    });
  });
}

export function flattenLanes(laneSets) {
  const lanes = [];

  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      lanes.push(lane);
      lanes.push(...flattenLanes(
        lane.childLaneSet ? [ lane.childLaneSet ] : []
      ));
    }
  }

  return lanes;
}

function laneContains(ancestor, candidate) {
  return flattenLanes(
    ancestor.childLaneSet ? [ ancestor.childLaneSet ] : []
  ).includes(candidate);
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
