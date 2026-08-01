import type { ModdleElement } from 'moddle';

import type {
  Bounds,
  LayoutRecord,
  LayoutState,
  SemanticPolicy
} from '../../Types.js';
import type {
  BpmnFlowElementsContainer,
  BpmnFlowNode,
  BpmnLane,
  BpmnLaneSet,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';

type FlowNode = ModdleElement<BpmnFlowNode>;
type Lane = ModdleElement<BpmnLane>;
type LaneSet = ModdleElement<BpmnLaneSet>;
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};
type LaneRecord = LayoutRecord & {
  element: FlowNode;
  bounds: Bounds;
};
type LaneMemberships = Map<FlowNode, Lane[]>;
type LaneRowState = {
  parents: Map<LaneRecord, LaneRecord>;
  members: Map<LaneRecord, LaneRecord[]>;
};
type RowsByLane = Map<Lane, LaneRecord[][]>;
type LaneHeights = Map<Lane, number>;
type LaneSemanticPolicy = Pick<SemanticPolicy,
  'backEdges' | 'straightEdges' | 'compactFeedbackNodes'
>;

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected lane layout value');
  }

  return value;
}

import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';
import {
  FEEDBACK_REGION_VERTICAL_GAP,
  LANE_CONTENT_PADDING,
  MIN_LANE_CONTENT_WIDTH,
  MIN_LANE_HEIGHT,
  VERTICAL_GAP
} from '../../Constants.js';
import { bounds } from '../../geometry/index.js';

export function applyLaneMembership(
    scope: ModdleElement<BpmnFlowElementsContainer>,
    records: LaneRecord[],
    graphEdges: FlowEdge[],
    policy: LaneSemanticPolicy,
    layout: LayoutState
): void {
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
  const laneHeights = measureLaneHeights(lanes, rowsByLane, policy);

  createLaneBounds(lanes, laneWidth, laneHeights, layout);
  positionLaneRows(lanes, rowsByLane, policy, layout);
}

function collectLaneMemberships(lanes: Lane[]): LaneMemberships {
  const memberships: LaneMemberships = new Map();

  for (const lane of lanes) {
    for (const node of lane.flowNodeRef || []) {
      if (!memberships.has(node)) {
        memberships.set(node, []);
      }

      getRequired(memberships.get(node)).push(lane);
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
          .filter((id): id is string => typeof id === 'string')
      );
    }

    memberships.set(node, deepest);
  }

  return memberships;
}

function prepareLaneContent(records: LaneRecord[]): number {
  const maxRight = Math.max(
    ...records.map(record => record.bounds.x + record.bounds.width),
    MIN_LANE_CONTENT_WIDTH
  );

  for (const record of records) {
    record.bounds.x += LANE_CONTENT_PADDING;
  }

  return maxRight + 2 * LANE_CONTENT_PADDING;
}

function groupLaneRows(
    lanes: Lane[],
    records: LaneRecord[],
    graphEdges: FlowEdge[],
    memberships: LaneMemberships,
    policy: LaneSemanticPolicy
): RowsByLane {
  const rowState = createLaneRowState(records);
  const recordByElement = new Map<FlowNode, LaneRecord>(
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

function createLaneRowState(records: LaneRecord[]): LaneRowState {
  return {
    parents: new Map<LaneRecord, LaneRecord>(records.map(record => [ record, record ])),
    members: new Map<LaneRecord, LaneRecord[]>(records.map(record => [ record, [ record ] ]))
  };
}

function mergeInitiallyAlignedRows(
    lanes: Lane[],
    records: LaneRecord[],
    memberships: LaneMemberships,
    rowState: LaneRowState
): void {
  for (const lane of lanes) {
    const recordsByCenter = new Map<number, LaneRecord>();

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
    graphEdges: FlowEdge[],
    memberships: LaneMemberships,
    recordByElement: Map<FlowNode, LaneRecord>,
    policy: LaneSemanticPolicy,
    rowState: LaneRowState
): void {
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

function mergeLaneRows(
    rowState: LaneRowState,
    a: LaneRecord,
    b: LaneRecord
): void {
  const rootA = findLaneRow(rowState.parents, a);
  const rootB = findLaneRow(rowState.parents, b);

  if (rootA === rootB) {
    return;
  }

  const membersA = getRequired(rowState.members.get(rootA));
  const membersB = getRequired(rowState.members.get(rootB));
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

function findLaneRow(
    parents: Map<LaneRecord, LaneRecord>,
    record: LaneRecord
): LaneRecord {
  let root = record;

  while (parents.get(root) !== root) {
    root = getRequired(parents.get(root));
  }

  while (parents.get(record) !== record) {
    const parent = getRequired(parents.get(record));

    parents.set(record, root);
    record = parent;
  }

  return root;
}

function collectRowsByLane(
    lanes: Lane[],
    records: LaneRecord[],
    memberships: LaneMemberships,
    rowState: LaneRowState
): RowsByLane {
  const rowsByLane: RowsByLane = new Map();

  for (const lane of lanes) {
    const rows = new Map<LaneRecord, LaneRecord[]>();
    const directRecords = records.filter(record => {
      return memberships.get(record.element)?.[0] === lane;
    });

    for (const record of directRecords) {
      const root = findLaneRow(rowState.parents, record);

      if (!rows.has(root)) {
        rows.set(root, []);
      }

      getRequired(rows.get(root)).push(record);
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

function measureLaneHeights(
    lanes: Lane[],
    rowsByLane: RowsByLane,
    policy: LaneSemanticPolicy
): LaneHeights {
  const laneHeights: LaneHeights = new Map();

  for (const lane of topLevelLanes(lanes)) {
    requiredLaneHeight(lane, rowsByLane, laneHeights, policy);
  }

  return laneHeights;
}

function requiredLaneHeight(
    lane: Lane,
    rowsByLane: RowsByLane,
    laneHeights: LaneHeights,
    policy: LaneSemanticPolicy
): number {
  if (laneHeights.has(lane)) {
    return getRequired(laneHeights.get(lane));
  }

  const rows = rowsByLane.get(lane) || [];
  const directHeight = rows.length
    ? rows.reduce((total, row) => {
      return total + Math.max(...row.map(record => record.bounds.height));
    }, 0) + totalRowGaps(rows, policy) + 2 * VERTICAL_GAP
    : 0;
  const childrenHeight = (lane.childLaneSet?.lanes || []).reduce((
      total,
      child
  ) => {
    return total + requiredLaneHeight(child, rowsByLane, laneHeights, policy);
  }, 0);
  const height = Math.max(MIN_LANE_HEIGHT, directHeight, childrenHeight);

  laneHeights.set(lane, height);
  return height;
}

function createLaneBounds(
    lanes: Lane[],
    width: number,
    laneHeights: LaneHeights,
    layout: LayoutState
): void {
  let y = 0;

  for (const lane of topLevelLanes(lanes)) {
    const height = getRequired(laneHeights.get(lane));

    addLaneLayout(lane, y, height, width, layout, laneHeights);
    y += height;
  }
}

function positionLaneRows(
    lanes: Lane[],
    rowsByLane: RowsByLane,
    policy: LaneSemanticPolicy,
    layout: LayoutState
): void {
  for (const lane of lanes) {
    const laneBounds = layout.shapes.get(lane);
    const rows = rowsByLane.get(lane) || [];

    if (!laneBounds || !rows.length) {
      continue;
    }

    const totalHeight = rows.reduce((total, row) => {
      return total + Math.max(...row.map(record => record.bounds.height));
    }, 0) + totalRowGaps(rows, policy);
    let recordY = laneBounds.y +
      Math.round((laneBounds.height - totalHeight) / 2);

    for (const [ index, row ] of rows.entries()) {
      const rowHeight = Math.max(
        ...row.map(record => record.bounds.height)
      );
      const centerY = recordY + rowHeight / 2;

      for (const record of row) {
        record.bounds.y = centerY - record.bounds.height / 2;
      }

      recordY += rowHeight + (
        index < rows.length - 1
          ? laneRowGap(row, getRequired(rows[index + 1]), policy)
          : 0
      );
    }
  }
}

function totalRowGaps(
    rows: LaneRecord[][],
    policy: LaneSemanticPolicy
): number {
  return rows.slice(1).reduce((total, row, index) => {
    return total + laneRowGap(getRequired(rows[index]), row, policy);
  }, 0);
}

function laneRowGap(
    a: LaneRecord[],
    b: LaneRecord[],
    policy: LaneSemanticPolicy
): number {
  const compact = policy.compactFeedbackNodes;
  const feedbackAdjacent = compact && [ ...a, ...b ].some(record => {
    return compact.has(record.element);
  });

  return feedbackAdjacent ? FEEDBACK_REGION_VERTICAL_GAP : VERTICAL_GAP;
}

function topLevelLanes(lanes: Lane[]): Lane[] {
  return lanes.filter(lane => {
    return !lanes.some(other => {
      return other !== lane && laneContains(other, lane);
    });
  });
}

export function flattenLanes(laneSets: LaneSet[]): Lane[] {
  const lanes: Lane[] = [];

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

function laneContains(ancestor: Lane, candidate: Lane): boolean {
  return flattenLanes(
    ancestor.childLaneSet ? [ ancestor.childLaneSet ] : []
  ).includes(candidate);
}

function addLaneLayout(
    lane: Lane,
    y: number,
    height: number,
    width: number,
    layout: LayoutState,
    laneHeights: LaneHeights
): void {
  layout.shapes.set(lane, bounds(0, y, width, height));

  const children = lane.childLaneSet?.lanes || [];

  if (!children.length) {
    return;
  }

  let childY = y;

  for (const child of children) {
    const childHeight = getRequired(laneHeights.get(child));

    addLaneLayout(child, childY, childHeight, width, layout, laneHeights);
    childY += childHeight;
  }
}
