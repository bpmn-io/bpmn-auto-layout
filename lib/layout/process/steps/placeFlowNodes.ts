import {
  clearBoundaryHandlerExits,
  packComponents,
  placeBoundaryEvents,
  placeRecords
} from '../placement/ShapePlacement.js';
import { applyLaneMembership } from '../placement/LanePlacement.js';

import { is } from '../../../di/DiUtil.js';
import type { LayoutRecord, ProcessLayoutContext } from '../../Types.js';

type GraphRecord = Parameters<typeof placeRecords>[0][number];
type GraphEdge = Parameters<typeof packComponents>[2][number];
type BoundaryEdge = Parameters<typeof packComponents>[3][number];

function isGraphRecord(record: LayoutRecord): record is GraphRecord {
  return !record.isBoundary && !record.isArtifact &&
    is(record.element, 'bpmn:FlowNode');
}

function isGraphEdge(element: unknown): element is GraphEdge {
  return is(element, 'bpmn:SequenceFlow') &&
    !!element.sourceRef && !!element.targetRef;
}

function isBoundaryEdge(element: unknown): element is BoundaryEdge {
  return isGraphEdge(element) && is(element.sourceRef, 'bpmn:BoundaryEvent') &&
    !!element.sourceRef.attachedToRef;
}

function getRequired<Value>(value: Value | null | undefined): Value {
  if (value === null || value === undefined) {
    throw new Error('Expected flow-node placement value');
  }

  return value;
}

export function placeFlowNodes(context: ProcessLayoutContext): ProcessLayoutContext {
  const { layout, scope } = context;
  const { records, recordsByElement } = context.placement;
  const {
    boundaryEdges,
    edges: graphEdges,
    nodes: graphNodes
  } = context.graph;
  const { policy, ranks } = context.semantics;
  const allShapeRecords = records.filter(isGraphRecord);
  const typedRecordsByElement = new Map(
    allShapeRecords.map(record => [ record.element, record ])
  );
  const graphRecords = graphNodes
    .map(element => recordsByElement.get(element))
    .filter((record): record is GraphRecord => !!record && isGraphRecord(record));
  const typedGraphEdges = graphEdges.filter(isGraphEdge);
  const typedBoundaryEdges = boundaryEdges.filter(isBoundaryEdge);
  const typedPolicy = getRequired(policy);
  const typedRanks = getRequired(ranks);

  placeRecords(graphRecords, typedRanks, typedPolicy);
  clearBoundaryHandlerExits(
    graphRecords,
    typedBoundaryEdges,
    typedRecordsByElement,
    typedPolicy
  );
  packComponents(scope, graphRecords, typedGraphEdges, typedBoundaryEdges, typedRanks);
  applyLaneMembership(scope, graphRecords, typedGraphEdges, typedPolicy, layout);
  placeBoundaryEvents(allShapeRecords, typedRecordsByElement);
  addRecordBounds(layout, graphRecords);
  addRecordBounds(
    layout,
    allShapeRecords.filter(record => record.isBoundary)
  );

  return context;
}

function addRecordBounds(
    layout: ProcessLayoutContext['layout'],
    records: GraphRecord[]
): void {
  for (const record of records) {
    layout.shapes.set(record.element, record.bounds);
  }
}
