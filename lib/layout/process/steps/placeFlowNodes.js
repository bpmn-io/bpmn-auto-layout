import {
  applyLaneMembership,
  clearBoundaryHandlerExits,
  packComponents,
  placeBoundaryEvents,
  placeRecords
} from '../placement/ShapePlacement.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function placeFlowNodes(context) {
  const { layout, scope } = context;
  const { records, recordsByElement } = context.placement;
  const {
    boundaryEdges,
    edges: graphEdges,
    nodes: graphNodes
  } = context.graph;
  const { policy, ranks } = context.semantics;
  const graphRecords = graphNodes.map(element => {
    return recordsByElement.get(element);
  });

  placeRecords(graphRecords, ranks, policy);
  clearBoundaryHandlerExits(
    graphRecords,
    boundaryEdges,
    recordsByElement,
    policy
  );
  packComponents(scope, graphRecords, graphEdges, boundaryEdges, ranks);
  applyLaneMembership(scope, graphRecords, graphEdges, policy, layout);
  placeBoundaryEvents(records, recordsByElement);
  addRecordBounds(layout, graphRecords);
  addRecordBounds(
    layout,
    records.filter(record => record.isBoundary)
  );

  return context;
}

function addRecordBounds(layout, records) {
  for (const record of records) {
    layout.shapes.set(record.element, record.bounds);
  }
}
