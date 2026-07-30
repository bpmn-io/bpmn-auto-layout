import type { ModdleElement } from 'moddle';

import type {
  BpmnElement,
  Bounds,
  LayoutRecord,
  RankAssignment,
  SemanticPolicy
} from '../../Types.js';
import type {
  BpmnBoundaryEvent,
  BpmnFlowNode,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';

type FlowNode = ModdleElement<BpmnFlowNode>;
type BoundaryEvent = ModdleElement<BpmnBoundaryEvent> & {
  attachedToRef: FlowNode;
};
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};
type BoundaryEdge = FlowEdge & {
  sourceRef: BoundaryEvent;
};
type ShapeRecord = LayoutRecord & {
  element: FlowNode;
  bounds: Bounds;
};
type BoundaryRecord = ShapeRecord & {
  element: BoundaryEvent;
};
type ShapeRecordsByElement = Map<FlowNode, ShapeRecord>;
type PlacementPolicy = Pick<SemanticPolicy,
  'bands' | 'components' | 'backEdges' | 'straightEdges'
>;
type RankRecords = Map<number, ShapeRecord[]>;
type ComponentItem = {
  component: ShapeRecord[];
  extents: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
  index: number;
  width: number;
  height: number;
};

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected shape placement value');
  }

  return value;
}

function isBoundaryRecord(record: ShapeRecord): record is BoundaryRecord {
  return record.isBoundary &&
    is(record.element, 'bpmn:BoundaryEvent') &&
    !!record.element.attachedToRef;
}

import { is } from '../../../di/DiUtil.js';
import { HORIZONTAL_GAP, VERTICAL_GAP, ROUTING_MARGIN, SEMANTIC_BAND_HEIGHT, BOUNDARY_EVENT_SPACING } from '../../Constants.js';
import { hasEventDefinition } from '../../bpmn/Predicates.js';
import { bounds, rectanglesOverlap, getRecordExtents } from '../../geometry/index.js';

export function placeRecords(
    records: ShapeRecord[],
    ranks: RankAssignment,
    policy: PlacementPolicy
): void {
  const byRank: RankRecords = new Map();

  for (const record of records) {
    const rank = ranks.rank.get(record.element) || 0;

    if (!byRank.has(rank)) {
      byRank.set(rank, []);
    }

    getRequired(byRank.get(rank)).push(record);
  }

  const rankNumbers = [ ...byRank.keys() ].sort((a, b) => a - b);
  const rankWidths = new Map<number, number>();
  let x = 0;

  for (const rank of rankNumbers) {
    const width = Math.max(...getRequired(byRank.get(rank)).map(record => record.size.width));
    rankWidths.set(rank, width);

    for (const record of getRequired(byRank.get(rank))) {
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
    const occupied = new Map<string, number>();

    for (const record of getRequired(byRank.get(rank)).sort((a, b) => a.index - b.index)) {
      const band = policy.bands.get(record.element) || 0;
      const key = `${policy.components.get(record.element)}:${band}`;
      const offset = occupied.get(key) || 0;
      record.bounds.y += offset;
      occupied.set(key, offset + record.size.height + VERTICAL_GAP);
    }
  }

}

export function clearBoundaryHandlerExits(
    records: ShapeRecord[],
    boundaryEdges: BoundaryEdge[],
    recordsByElement: ShapeRecordsByElement,
    policy: PlacementPolicy
): void {
  const ordered = [ ...boundaryEdges ].sort((a, b) => {
    const bandA = policy.bands.get(a.targetRef) || 0;
    const bandB = policy.bands.get(b.targetRef) || 0;

    return Math.abs(bandA) - Math.abs(bandB);
  });

  for (const edge of ordered) {
    const boundary = getRequired(recordsByElement.get(edge.sourceRef));
    const host = getRequired(recordsByElement.get(edge.sourceRef.attachedToRef));
    const target = getRequired(recordsByElement.get(edge.targetRef));
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

export function packComponents(
    scope: BpmnElement,
    records: ShapeRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[],
    ranks: RankAssignment
): void {
  const parent = new Map<FlowNode, FlowNode>(
    records.map(record => [ record.element, record.element ])
  );
  const find = (element: FlowNode): FlowNode => {
    const root = getRequired(parent.get(element));

    if (root === element) {
      return root;
    }

    const compressed = find(root);
    parent.set(element, compressed);
    return compressed;
  };
  const union = (a: FlowNode, b: FlowNode): void => {
    const rootA = find(a);
    const rootB = find(b);

    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  for (const edge of [ ...graphEdges, ...boundaryEdges ]) {
    if (is(edge.sourceRef, 'bpmn:BoundaryEvent') &&
        !edge.sourceRef.attachedToRef) {
      continue;
    }

    const source = is(edge.sourceRef, 'bpmn:BoundaryEvent')
      ? edge.sourceRef.attachedToRef
      : edge.sourceRef;

    if (source && parent.has(source) && parent.has(edge.targetRef)) {
      union(source, edge.targetRef);
    }
  }

  const components = new Map<FlowNode, ShapeRecord[]>();

  for (const record of records) {
    const root = find(record.element);

    if (!components.has(root)) {
      components.set(root, []);
    }

    getRequired(components.get(root)).push(record);
  }

  const ordered: ShapeRecord[][] = [ ...components.values() ].sort((a, b) => {
    return Math.min(...a.map(record => record.index)) - Math.min(...b.map(record => record.index));
  });

  for (const component of ordered) {
    separateRankOverlaps(component, ranks);
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

function packCompactComponents(components: ShapeRecord[][]): void {
  const items: ComponentItem[] = components.map(component => {
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
  const placed: Bounds[] = [];

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

function rectanglesOverlapWithGap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width + HORIZONTAL_GAP &&
    a.x + a.width + HORIZONTAL_GAP > b.x &&
    a.y < b.y + b.height + VERTICAL_GAP &&
    a.y + a.height + VERTICAL_GAP > b.y;
}

function separateRankOverlaps(records: ShapeRecord[], ranks: RankAssignment): void {
  const byRank: RankRecords = new Map();

  for (const record of records) {
    const rank = ranks.rank.get(record.element) || 0;

    if (!byRank.has(rank)) {
      byRank.set(rank, []);
    }

    getRequired(byRank.get(rank)).push(record);
  }

  for (const rankRecords of byRank.values()) {
    const placed: ShapeRecord[] = [];

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

export function placeBoundaryEvents(
    records: ShapeRecord[],
    recordsByElement: ShapeRecordsByElement
): void {
  const boundaries = records.filter(isBoundaryRecord);
  const byHost = new Map<FlowNode, BoundaryRecord[]>();

  for (const record of boundaries) {
    const host = record.element.attachedToRef;

    if (!byHost.has(host)) {
      byHost.set(host, []);
    }

    getRequired(byHost.get(host)).push(record);
  }

  for (const [ host, attachers ] of byHost) {
    const hostRecord = getRequired(recordsByElement.get(host));
    const hostBounds = hostRecord.bounds;
    const top = attachers.filter(record => hasEventDefinition(record.element, 'bpmn:EscalationEventDefinition'));
    const bottom = attachers.filter(record => !top.includes(record));

    placeAttachers(top, hostBounds, true, recordsByElement);
    placeAttachers(bottom, hostBounds, false, recordsByElement);
  }
}

function placeAttachers(
    records: BoundaryRecord[],
    hostBounds: Bounds,
    onTop: boolean,
    recordsByElement: ShapeRecordsByElement
): void {
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

function boundaryHandlerDistance(
    record: BoundaryRecord,
    hostBounds: Bounds,
    outward: number,
    recordsByElement: ShapeRecordsByElement
): number {
  const targets = (record.element.outgoing || [])
    .filter((flow): flow is FlowEdge => !!flow.targetRef)
    .map(flow => recordsByElement.get(flow.targetRef)?.bounds)
    .filter((target): target is Bounds => !!target);

  if (!targets.length) {
    return 0;
  }

  const targetCenterY = targets.reduce((sum, target) => {
    return sum + target.y + target.height / 2;
  }, 0) / targets.length;
  const hostSideY = onHostSide(hostBounds, outward);

  return outward * (targetCenterY - hostSideY);
}

function onHostSide(hostBounds: Bounds, outward: number): number {
  return outward < 0 ? hostBounds.y : hostBounds.y + hostBounds.height;
}
