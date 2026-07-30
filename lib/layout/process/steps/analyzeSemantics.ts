import { is } from '../../../di/DiUtil.js';
import {
  assignRanks,
  createSemanticPolicy
} from '../semantics/SemanticPolicy.js';
import { compactSemanticBands } from '../semantics/CompactBands.js';

import type { LayoutRecord, ProcessLayoutContext } from '../../Types.js';

type GraphRecord = Parameters<typeof createSemanticPolicy>[1][number];
type GraphEdge = Parameters<typeof createSemanticPolicy>[2][number];
type BoundaryEdge = Parameters<typeof createSemanticPolicy>[3][number];

function isGraphRecord(record: LayoutRecord): record is GraphRecord {
  const eventSubProcess = is(record.element, 'bpmn:SubProcess') &&
    record.element.triggeredByEvent;

  return !record.isBoundary &&
    !record.isArtifact &&
    !eventSubProcess &&
    is(record.element, 'bpmn:FlowNode');
}

function isGraphEdge(element: unknown, graphSet: Set<GraphRecord['element']>): element is GraphEdge {
  return is(element, 'bpmn:SequenceFlow') &&
    !!element.sourceRef &&
    !!element.targetRef &&
    graphSet.has(element.sourceRef) &&
    graphSet.has(element.targetRef);
}

function isBoundaryEdge(element: unknown): element is BoundaryEdge {
  return is(element, 'bpmn:SequenceFlow') &&
    is(element.sourceRef, 'bpmn:BoundaryEvent') &&
    !!element.sourceRef.attachedToRef &&
    !!element.targetRef;
}

export function analyzeSemantics(context: ProcessLayoutContext): ProcessLayoutContext {
  const { scope } = context;
  const { sequenceFlows } = context.elements;
  const { records } = context.placement;
  const graphRecords = records.filter(isGraphRecord);
  const graphSet = new Set(graphRecords.map(record => record.element));
  const graphEdges = sequenceFlows.filter(flow => isGraphEdge(flow, graphSet));
  const boundaryEdges = sequenceFlows.filter(isBoundaryEdge);
  const policy = createSemanticPolicy(
    scope,
    graphRecords,
    graphEdges,
    boundaryEdges,
    records
  );
  const ranks = assignRanks(
    graphRecords,
    graphEdges,
    boundaryEdges,
    policy
  );

  compactSemanticBands(
    graphRecords,
    graphEdges,
    boundaryEdges,
    ranks,
    policy
  );

  return {
    ...context,
    graph: {
      nodes: graphRecords.map(record => record.element),
      edges: graphEdges,
      boundaryEdges
    },
    semantics: {
      policy,
      ranks
    }
  };
}
