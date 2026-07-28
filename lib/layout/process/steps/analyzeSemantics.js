import { is } from '../../../di/DiUtil.js';
import {
  assignRanks,
  createSemanticPolicy
} from '../semantics/SemanticPolicy.js';
import { compactSemanticBands } from '../semantics/CompactBands.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function analyzeSemantics(context) {
  const { scope } = context;
  const { sequenceFlows } = context.elements;
  const { records } = context.placement;
  const graphRecords = records.filter(record => {
    return !record.isBoundary &&
      !record.isArtifact &&
      !(is(record.element, 'bpmn:SubProcess') &&
        record.element.triggeredByEvent);
  });
  const graphSet = new Set(graphRecords.map(record => record.element));
  const graphEdges = sequenceFlows.filter(flow => {
    return graphSet.has(flow.sourceRef) && graphSet.has(flow.targetRef);
  });
  const boundaryEdges = sequenceFlows.filter(flow => {
    return is(flow.sourceRef, 'bpmn:BoundaryEvent');
  });
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
