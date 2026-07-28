import { getDefaultSize, is } from '../di/DiUtil.js';
import { LayoutError } from '../LayoutError.js';
import {
  EXPANDED_SUBPROCESS_LABEL_HEIGHT,
  MIN_PARTICIPANT_HEIGHT,
  MIN_PARTICIPANT_WIDTH,
  MIN_SUB_PROCESS_HEIGHT,
  MIN_SUB_PROCESS_WIDTH,
  PARTICIPANT_HEADER_WIDTH,
  SUB_PROCESS_PADDING,
  VERTICAL_GAP
} from './Constants.js';
import {
  isArtifact,
  isExteriorArtifact,
  isSupportedVisualElement
} from './BpmnUtil.js';
import {
  bounds,
  createLayout,
  getExpandedChildShapes,
  getExtents,
  getParticipantContentExtents,
  translateLayout
} from './LayoutUtil.js';
import {
  validateBoundaryEvents,
  validateLinks,
  validateSequenceFlows
} from './Validation.js';
import { assignRanks, createSemanticPolicy, edgePriority } from './SemanticPolicy.js';
import {
  applyLaneMembership,
  clearBoundaryHandlerExits,
  compactSemanticBands,
  flattenLanes,
  packComponents,
  placeBoundaryEvents,
  placeRecords
} from './ShapePlacement.js';
import { routeConnection } from './SequenceFlowRouter.js';
import { needsExpandedSubProcessTitleClearance } from './LabelLayouter.js';
import { layoutGroups } from './GroupLayouter.js';
import { placeArtifacts } from './ArtifactLayoutStage.js';

/**
 * @typedef {import('./Types.js').ProcessLayoutContext} ProcessLayoutContext
 * @typedef {import('./Types.js').ProcessLayoutOptions} ProcessLayoutOptions
 */

export const PROCESS_LAYOUT_STEPS = Object.freeze([
  extractElements,
  layoutChildScopes,
  validateScope,
  analyzeSemantics,
  placeFlowNodes,
  placeExpandedChildren,
  routeSequenceFlows,
  placeEventSubProcesses,
  placeScopeArtifacts,
  placeGroups
]);

/**
 * Lay out one process or sub-process using a composable sequence of named
 * transforms. Callers may provide an internally customized step list.
 */
export function layoutProcessScope(
    scope,
    options = {}) {
  const initialContext = createProcessLayoutContext(scope, options);
  const { steps } = initialContext.options;
  const context = steps.reduce((current, runStep) => {
    return runStep(current);
  }, initialContext);

  return {
    layout: context.layout,
    warnings: context.warnings
  };
}

/**
 * @param {Object} scope
 * @param {Partial<ProcessLayoutOptions>} options
 * @returns {ProcessLayoutContext}
 */
export function createProcessLayoutContext(
    scope,
    {
      expandedIds = new Set(),
      participantProcess = false,
      messageFlowEndpointDirections = new Map(),
      steps = PROCESS_LAYOUT_STEPS
    } = {}) {
  return {
    scope,
    options: {
      expandedIds,
      participantProcess,
      messageFlowEndpointDirections,
      steps
    },
    elements: {
      groups: [],
      sequenceFlows: [],
      associations: [],
      records: [],
      recordsByElement: new Map()
    },
    graph: {
      records: [],
      edges: [],
      boundaryEdges: []
    },
    semantics: {
      policy: null,
      ranks: null
    },
    layout: createLayout(scope),
    warnings: []
  };
}

export function createLayoutRecord(element, index, expandedIds = new Set()) {
  const size = getDefaultSize(element);

  if (!size || !isSupportedVisualElement(element)) {
    throw new LayoutError(
      'UNSUPPORTED_ELEMENT',
      element.id,
      `Cannot generate DI for visual BPMN element "${element.$type}".`
    );
  }

  return {
    element,
    index,
    size,
    isBoundary: is(element, 'bpmn:BoundaryEvent'),
    isArtifact: isArtifact(element),
    expanded: is(element, 'bpmn:SubProcess') && expandedIds.has(element.id),
    child: null
  };
}

export function getParticipantContainerBounds(process, layout) {
  const extents = getParticipantContentExtents(layout);
  const hasLanes = flattenLanes(process.laneSets || []).length > 0;
  const leadingPadding = hasLanes
    ? PARTICIPANT_HEADER_WIDTH
    : PARTICIPANT_HEADER_WIDTH + SUB_PROCESS_PADDING;
  const trailingPadding = hasLanes ? 0 : SUB_PROCESS_PADDING;
  const verticalPadding = hasLanes ? 0 : SUB_PROCESS_PADDING;
  const width = Math.max(
    MIN_PARTICIPANT_WIDTH,
    extents.width + leadingPadding + trailingPadding
  );
  const height = Math.max(
    MIN_PARTICIPANT_HEIGHT,
    extents.height + 2 * verticalPadding
  );

  return bounds(
    extents.minX - leadingPadding,
    extents.minY - verticalPadding,
    width,
    height
  );
}

function extractElements(context) {
  const { scope } = context;
  const { expandedIds } = context.options;
  const flowElements = scope.flowElements || [];
  const artifacts = scope.artifacts || [];
  const groups = artifacts.filter(element => is(element, 'bpmn:Group'));
  const sequenceFlows = flowElements.filter(element => is(element, 'bpmn:SequenceFlow'));
  const dataAssociations = flowElements.flatMap(element => [
    ...(element.dataInputAssociations || []),
    ...(element.dataOutputAssociations || [])
  ]);
  const associations = [ ...flowElements, ...artifacts ]
    .filter(element => is(element, 'bpmn:Association'))
    .concat(dataAssociations);
  const nodeElements = [ ...new Set([
    ...flowElements.filter(element => {
      return !is(element, 'bpmn:SequenceFlow') &&
        !is(element, 'bpmn:Association') &&
        !is(element, 'bpmn:Group') &&
        !is(element, 'bpmn:DataObject');
    }),
    ...artifacts.filter(element => {
      return isArtifact(element) && !is(element, 'bpmn:Group');
    })
  ]) ];
  const records = nodeElements.map((element, index) => {
    return createLayoutRecord(element, index, expandedIds);
  });

  return {
    ...context,
    elements: {
      groups,
      sequenceFlows,
      associations,
      records,
      recordsByElement: new Map(records.map(record => [ record.element, record ]))
    }
  };
}

function layoutChildScopes(context) {
  const { layout, warnings } = context;
  const { records } = context.elements;
  const {
    expandedIds,
    messageFlowEndpointDirections,
    steps
  } = context.options;

  for (const record of records) {
    if (!is(record.element, 'bpmn:SubProcess')) {
      continue;
    }

    const childResult = layoutProcessScope(record.element, {
      expandedIds,
      messageFlowEndpointDirections,
      steps
    });

    record.child = childResult.layout;
    warnings.push(...childResult.warnings);

    if (record.expanded) {
      record.size = sizeExpandedSubProcess(getExtents(record.child));
    }

    layout.children.push(record.child);
  }

  return context;
}

function validateScope(context) {
  const { scope } = context;
  const { records, recordsByElement, sequenceFlows } = context.elements;

  validateSequenceFlows(sequenceFlows, recordsByElement, scope);
  validateBoundaryEvents(records, recordsByElement, scope);
  validateLinks(records, scope);

  return context;
}

function analyzeSemantics(context) {
  const { scope } = context;
  const { records, sequenceFlows } = context.elements;
  const graphRecords = records.filter(record => !record.isBoundary && !record.isArtifact &&
    !(is(record.element, 'bpmn:SubProcess') && record.element.triggeredByEvent));
  const graphSet = new Set(graphRecords.map(record => record.element));
  const graphEdges = sequenceFlows.filter(flow => graphSet.has(flow.sourceRef) &&
    graphSet.has(flow.targetRef));
  const boundaryEdges = sequenceFlows.filter(flow => is(flow.sourceRef, 'bpmn:BoundaryEvent'));
  const policy = createSemanticPolicy(scope, graphRecords, graphEdges, boundaryEdges, records);
  const ranks = assignRanks(graphRecords, graphEdges, boundaryEdges, policy);

  policy.backEdges = ranks.backEdges;

  return {
    ...context,
    graph: {
      records: graphRecords,
      edges: graphEdges,
      boundaryEdges
    },
    semantics: {
      policy,
      ranks
    }
  };
}

function placeFlowNodes(context) {
  const { layout, scope } = context;
  const { records, recordsByElement } = context.elements;
  const {
    boundaryEdges,
    edges: graphEdges,
    records: graphRecords
  } = context.graph;
  const { policy, ranks } = context.semantics;

  compactSemanticBands(graphRecords, graphEdges, boundaryEdges, ranks, policy);
  placeRecords(graphRecords, ranks, policy);
  clearBoundaryHandlerExits(graphRecords, boundaryEdges, recordsByElement, policy);
  packComponents(scope, graphRecords, graphEdges, boundaryEdges);
  applyLaneMembership(scope, graphRecords, graphEdges, policy, layout);
  placeBoundaryEvents(records, recordsByElement, layout);
  addRecordBounds(layout, graphRecords);
  addRecordBounds(layout, records.filter(record => record.isBoundary));

  return context;
}

function placeExpandedChildren(context) {
  for (const record of context.elements.records) {
    if (!record.expanded || !record.child || !record.bounds) {
      continue;
    }
    const extents = getExtents(record.child);
    translateLayout(
      record.child,
      record.bounds.x + SUB_PROCESS_PADDING - extents.minX,
      record.bounds.y + SUB_PROCESS_PADDING - extents.minY
    );
    record.child.emitInParent = true;

    if (needsExpandedSubProcessTitleClearance(
      record.element,
      record.bounds,
      record.child
    )) {
      translateLayout(record.child, 0, EXPANDED_SUBPROCESS_LABEL_HEIGHT);
    }
  }

  return context;
}

function routeSequenceFlows(context) {
  const { layout } = context;
  const { sequenceFlows } = context.elements;
  const { policy } = context.semantics;
  const routedConnections = [];
  const shapes = [ ...layout.shapes.entries(), ...getExpandedChildShapes(layout) ]
    .filter(([ element ]) => {
      return !is(element, 'bpmn:Lane') &&
        !is(element, 'bpmn:Participant') &&
        !isArtifact(element);
    })
    .map(([ element, rect ]) => ({ element, rect }));
  const ordered = [ ...sequenceFlows ].sort((a, b) => {
    return edgePriority(a, policy) - edgePriority(b, policy) ||
      policy.edgeOrder.get(a) - policy.edgeOrder.get(b);
  });

  for (const flow of ordered) {
    const source = layout.shapes.get(flow.sourceRef);
    const target = layout.shapes.get(flow.targetRef);

    if (!source || !target) {
      continue;
    }

    const points = routeConnection(flow, source, target, shapes, routedConnections, policy);
    layout.edges.set(flow, points);
    routedConnections.push({ flow, points });
  }

  return context;
}

function placeEventSubProcesses(context) {
  const { layout } = context;
  const { records } = context.elements;
  const eventSubProcesses = records.filter(record => {
    return is(record.element, 'bpmn:SubProcess') && record.element.triggeredByEvent;
  });
  let nextEventSubProcessY = getExtents(layout).maxY + VERTICAL_GAP;

  for (const record of eventSubProcesses) {
    if (!record.expanded) {
      record.bounds = bounds(0, nextEventSubProcessY, record.size.width, record.size.height);
      layout.shapes.set(record.element, record.bounds);
      nextEventSubProcessY += record.size.height + VERTICAL_GAP;
      continue;
    }

    const extents = getExtents(record.child);
    const size = sizeExpandedSubProcess(extents);

    record.bounds = bounds(0, nextEventSubProcessY, size.width, size.height);
    layout.shapes.set(record.element, record.bounds);
    translateLayout(
      record.child,
      record.bounds.x + SUB_PROCESS_PADDING - extents.minX,
      record.bounds.y + SUB_PROCESS_PADDING - extents.minY
    );
    record.child.emitInParent = true;
    nextEventSubProcessY += size.height + VERTICAL_GAP;
  }

  return context;
}

function placeScopeArtifacts(context) {
  const { layout, scope } = context;
  const { associations, records } = context.elements;
  const {
    messageFlowEndpointDirections,
    participantProcess
  } = context.options;

  if (!participantProcess) {
    placeArtifacts({
      records,
      associations,
      layout,
      reservedVerticalEndpointDirections: messageFlowEndpointDirections
    });
    return context;
  }

  const interiorArtifacts = records.filter(record => {
    return record.isArtifact && !isExteriorArtifact(record.element);
  });
  const exteriorArtifacts = records.filter(record => {
    return record.isArtifact && isExteriorArtifact(record.element);
  });

  placeArtifacts({
    records: interiorArtifacts,
    associations,
    layout,
    reservedVerticalEndpointDirections: messageFlowEndpointDirections
  });
  placeArtifacts({
    records: exteriorArtifacts,
    associations,
    layout,
    additionalBoundaryContainers: [ {
      rect: getParticipantContainerBounds(scope, layout),
      containsOwner: true,
      participant: true
    } ],
    reservedVerticalEndpointDirections: messageFlowEndpointDirections
  });

  return context;
}

function placeGroups(context) {
  context.warnings.push(...layoutGroups(context.elements.groups, context.layout));

  return context;
}

function sizeExpandedSubProcess(childExtents) {
  return {
    width: Math.max(MIN_SUB_PROCESS_WIDTH, childExtents.width + 2 * SUB_PROCESS_PADDING),
    height: Math.max(MIN_SUB_PROCESS_HEIGHT, childExtents.height + 2 * SUB_PROCESS_PADDING)
  };
}

function addRecordBounds(layout, records) {
  for (const record of records) {
    layout.shapes.set(record.element, record.bounds);
  }
}
