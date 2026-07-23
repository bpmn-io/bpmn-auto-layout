import { BpmnModdle } from 'bpmn-moddle';

import { DiFactory } from './di/DiFactory.js';
import { getDefaultSize, is } from './di/DiUtil.js';
import { LayoutError } from './LayoutError.js';
import { LayoutWarning } from './LayoutWarning.js';
import { HORIZONTAL_GAP, VERTICAL_GAP, SUB_PROCESS_PADDING, PARTICIPANT_HEADER_WIDTH, MIN_PARTICIPANT_WIDTH, MIN_PARTICIPANT_HEIGHT, MIN_SUB_PROCESS_WIDTH, MIN_SUB_PROCESS_HEIGHT, EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE, EXPANDED_SUBPROCESS_LABEL_HEIGHT } from './layout/Constants.js';
import {
  isArtifact,
  isExteriorArtifact,
  isSupportedVisualElement,
  isSupportedVisualConnection,
  getExpandedIds
} from './layout/BpmnUtil.js';
import {
  createLayout,
  bounds,
  normalizeLayout,
  translateLayout,
  getExtents,
  getParticipantContentExtents,
  hasParticipantContent,
  getShapeExtents,
  getExpandedChildEdges,
  getExpandedChildShapes
} from './layout/LayoutUtil.js';
import {
  validateSequenceFlows,
  validateMessageFlows,
  validateBoundaryEvents,
  validateLinks,
  validateInputVisuals,
  validateParseWarnings
} from './layout/Validation.js';
import { createSemanticPolicy, assignRanks, edgePriority } from './layout/SemanticPolicy.js';
import {
  placeRecords,
  clearBoundaryHandlerExits,
  compactSemanticBands,
  packComponents,
  applyLaneMembership,
  flattenLanes,
  placeBoundaryEvents
} from './layout/ShapePlacement.js';
import { routeConnection } from './layout/SequenceFlowRouter.js';
import {
  findContainingArtifactContainers,
  artifactSizeCandidates,
  findArtifactPlacement,
  routeArtifactAssociation
} from './layout/ArtifactLayouter.js';
import {
  sizeAndPositionParticipantsFromMessageAnchors,
  includeResizableParticipantMessageDocks,
  assignMessageFlowChannelOffsets,
  orderParticipantsByMessageFlow,
  alignParticipantsHorizontally,
  alignParticipantComponentsLeft,
  getMessageObstacles,
  routeMessageFlows
} from './layout/CollaborationLayouter.js';
import {
  layoutExternalLabels,
  needsExpandedSubProcessTitleClearance
} from './layout/LabelLayouter.js';
import { layoutGroups } from './layout/GroupLayouter.js';
import { emitLayout, orientPlaneDockings } from './di/LayoutEmitter.js';

/**
 * Orchestrates greenfield BPMN layout across semantic analysis, placement,
 * routing, and DI emission.
 */
export class Layouter {
  constructor() {
    this.moddle = new BpmnModdle();
    this.diFactory = new DiFactory(this.moddle);
    this.expandedIds = new Set();
    this.warnings = [];
  }

  async layoutProcess(xml) {
    this.warnings = [];
    const parsed = await this.moddle.fromXML(xml);
    const definitions = parsed.rootElement;
    validateParseWarnings(parsed.warnings || [], xml);
    const root = this.selectRoot(definitions);

    if (!root) {
      return {
        xml: (await this.moddle.toXML(definitions, { format: true })).xml,
        warnings: this.warnings
      };
    }

    this.expandedIds = getExpandedIds(definitions, root);
    validateInputVisuals(definitions, root);
    definitions.diagrams = [];

    const layout = is(root, 'bpmn:Collaboration')
      ? this.layoutCollaboration(root)
      : this.layoutScope(root);

    normalizeLayout(layout);
    this.emitDiagram(definitions, root, layout);
    this.emitCollapsedSubProcessDiagrams(definitions, layout);
    this.warnForMissingDi(root, definitions);

    return {
      xml: (await this.moddle.toXML(definitions, { format: true })).xml,
      warnings: this.warnings
    };
  }

  selectRoot(definitions) {
    const roots = definitions.rootElements || [];
    const collaboration = roots.find(element => is(element, 'bpmn:Collaboration'));

    if (collaboration) {
      const participants = collaboration.participants || [];

      if (!participants.some(participant => participant.processRef)) {
        const invalidParticipant = participants.find(participant => participant.$attrs.processRef);

        if (invalidParticipant) {
          throw new LayoutError(
            'INVALID_PARTICIPANT_PROCESS_REFERENCE',
            invalidParticipant.id,
            'A participant processRef must reference a declared process.'
          );
        }

        throw new LayoutError(
          'UNSUPPORTED_COLLABORATION',
          collaboration.id,
          'A collaboration needs at least one participant with a processRef.'
        );
      }

      return collaboration;
    }

    return roots.find(element => is(element, 'bpmn:Process')) || null;
  }

  layoutCollaboration(collaboration) {
    validateMessageFlows(collaboration.messageFlows || []);

    const layout = createLayout(collaboration);
    const participantLayouts = new Map();
    const anchorPositionedParticipants = new Set();
    const expandableParticipants = new Set();
    let nextParticipantY = 0;

    for (const participant of collaboration.participants || []) {
      const process = participant.processRef;

      if (!process) {
        const size = getDefaultSize(participant);
        layout.shapes.set(participant, bounds(0, 0, size.width, size.height));
        anchorPositionedParticipants.add(participant);
        expandableParticipants.add(participant);
        continue;
      }

      const processLayout = this.layoutScope(process, true);
      const participantRect = this.getParticipantContainerBounds(process, processLayout);
      const dx = -participantRect.x;
      const dy = -participantRect.y;

      translateLayout(processLayout, dx, dy);

      layout.shapes.set(participant, bounds(
        0,
        0,
        participantRect.width,
        participantRect.height
      ));
      participantLayouts.set(participant, processLayout);

      if (!hasParticipantContent(processLayout)) {
        anchorPositionedParticipants.add(participant);
        expandableParticipants.add(participant);
      }

      processLayout.emitInParent = true;
      layout.children.push(processLayout);
    }

    const localCollaborationShapes = new Map([
      ...layout.shapes,
      ...getExpandedChildShapes(layout)
    ]);
    const messageFlowChannelOffsets = assignMessageFlowChannelOffsets(
      collaboration,
      localCollaborationShapes
    );

    sizeAndPositionParticipantsFromMessageAnchors(
      collaboration,
      layout.shapes,
      localCollaborationShapes,
      messageFlowChannelOffsets,
      anchorPositionedParticipants,
      expandableParticipants
    );
    const participantOrder = orderParticipantsByMessageFlow(
      collaboration,
      layout.shapes,
      localCollaborationShapes
    );

    for (const participant of participantOrder) {
      const participantBounds = layout.shapes.get(participant);
      const processLayout = participantLayouts.get(participant);

      if (processLayout) {
        const extents = getExtents(processLayout);
        const footprintTop = Math.min(0, extents.minY);
        const footprintBottom = Math.max(participantBounds.height, extents.maxY);
        const participantY = nextParticipantY - footprintTop;

        participantBounds.y = participantY;
        translateLayout(processLayout, 0, participantY);
        nextParticipantY += footprintBottom - footprintTop + VERTICAL_GAP;
      } else {
        participantBounds.y = nextParticipantY;
        nextParticipantY += participantBounds.height + VERTICAL_GAP;
      }
    }

    let collaborationShapes = new Map([
      ...layout.shapes,
      ...getExpandedChildShapes(layout)
    ]);
    const participantPositions = alignParticipantsHorizontally(
      collaboration,
      layout.shapes,
      collaborationShapes,
      getExpandedChildEdges(layout),
      messageFlowChannelOffsets,
      anchorPositionedParticipants,
      expandableParticipants
    );

    for (const [ participant, x ] of participantPositions) {
      const participantBounds = layout.shapes.get(participant);
      const processLayout = participantLayouts.get(participant);
      const dx = x - participantBounds.x;

      participantBounds.x = x;

      if (processLayout) {
        translateLayout(processLayout, dx, 0);
      }
    }

    collaborationShapes = new Map([
      ...layout.shapes,
      ...getExpandedChildShapes(layout)
    ]);
    sizeAndPositionParticipantsFromMessageAnchors(
      collaboration,
      layout.shapes,
      collaborationShapes,
      messageFlowChannelOffsets,
      anchorPositionedParticipants,
      expandableParticipants
    );

    for (const [ participant, dx ] of alignParticipantComponentsLeft(
      collaboration,
      layout.shapes
    )) {
      const participantBounds = layout.shapes.get(participant);
      const processLayout = participantLayouts.get(participant);

      participantBounds.x += dx;

      if (processLayout) {
        translateLayout(processLayout, dx, 0);
      }
    }

    compactParticipantRows(
      participantOrder,
      layout.shapes,
      participantLayouts
    );

    collaborationShapes = new Map([
      ...layout.shapes,
      ...getExpandedChildShapes(layout)
    ]);
    const messageObstacles = getMessageObstacles(collaborationShapes);
    let participantBoundsChanged;

    do {
      const routes = routeMessageFlows(
        collaboration,
        layout.shapes,
        collaborationShapes,
        messageObstacles,
        messageFlowChannelOffsets
      );

      for (const [ messageFlow, points ] of routes) {
        layout.edges.set(messageFlow, points);
      }

      participantBoundsChanged = includeResizableParticipantMessageDocks(
        collaboration,
        layout.shapes,
        layout.edges,
        expandableParticipants
      );
    } while (participantBoundsChanged);

    const artifacts = collaboration.artifacts || [];
    const groups = artifacts.filter(element => is(element, 'bpmn:Group'));
    const artifactRecords = artifacts
      .filter(element => isArtifact(element) && !is(element, 'bpmn:Group'))
      .map((element, index) => this.createRecord(element, index));
    const associations = artifacts.filter(element => is(element, 'bpmn:Association'));

    this.placeArtifacts(artifactRecords, associations, layout);
    this.warnings.push(...layoutGroups(groups, layout));

    return layout;
  }

  layoutScope(scope, participantProcess = false) {
    const layout = createLayout(scope);
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

    const records = nodeElements.map((element, index) => this.createRecord(element, index));

    const recordsByElement = new Map(records.map(record => [ record.element, record ]));

    for (const record of records) {
      if (!is(record.element, 'bpmn:SubProcess')) {
        continue;
      }

      record.child = this.layoutScope(record.element);

      if (record.expanded) {
        const childExtents = getExtents(record.child);
        record.size = {
          width: Math.max(MIN_SUB_PROCESS_WIDTH, childExtents.width + 2 * SUB_PROCESS_PADDING),
          height: Math.max(MIN_SUB_PROCESS_HEIGHT, childExtents.height + 2 * SUB_PROCESS_PADDING)
        };
      }

      layout.children.push(record.child);
    }

    validateSequenceFlows(sequenceFlows, recordsByElement, scope);
    validateBoundaryEvents(records, recordsByElement, scope);
    validateLinks(records, scope);

    const graphRecords = records.filter(record => !record.isBoundary && !record.isArtifact &&
      !(is(record.element, 'bpmn:SubProcess') && record.element.triggeredByEvent));
    const graphSet = new Set(graphRecords.map(record => record.element));
    const graphEdges = sequenceFlows.filter(flow => graphSet.has(flow.sourceRef) &&
      graphSet.has(flow.targetRef));
    const boundaryEdges = sequenceFlows.filter(flow => is(flow.sourceRef, 'bpmn:BoundaryEvent'));

    const policy = createSemanticPolicy(scope, graphRecords, graphEdges, boundaryEdges, records);
    const ranks = assignRanks(graphRecords, graphEdges, boundaryEdges, policy);
    policy.backEdges = ranks.backEdges;
    compactSemanticBands(graphRecords, graphEdges, boundaryEdges, ranks, policy);
    placeRecords(graphRecords, ranks, policy);
    clearBoundaryHandlerExits(graphRecords, boundaryEdges, recordsByElement, policy);
    packComponents(scope, graphRecords, graphEdges, boundaryEdges);
    applyLaneMembership(scope, graphRecords, graphEdges, policy, layout);
    placeBoundaryEvents(records, recordsByElement, layout);

    for (const record of graphRecords) {
      layout.shapes.set(record.element, record.bounds);
    }

    for (const record of records.filter(record => record.isBoundary)) {
      layout.shapes.set(record.element, record.bounds);
    }

    this.placeExpandedChildren(records, layout);
    this.routeSequenceFlows(sequenceFlows, layout, policy);
    this.placeEventSubProcesses(records, layout);
    if (participantProcess) {
      const interiorArtifacts = records.filter(record => {
        return record.isArtifact && !isExteriorArtifact(record.element);
      });
      const exteriorArtifacts = records.filter(record => {
        return record.isArtifact && isExteriorArtifact(record.element);
      });

      this.placeArtifacts(interiorArtifacts, associations, layout);

      const participantBounds = this.getParticipantContainerBounds(scope, layout);

      this.placeArtifacts(exteriorArtifacts, associations, layout, [ {
        rect: participantBounds,
        containsOwner: true,
        participant: true
      } ]);
    } else {
      this.placeArtifacts(records, associations, layout);
    }
    this.warnings.push(...layoutGroups(groups, layout));

    return layout;
  }

  createRecord(element, index) {
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
      expanded: is(element, 'bpmn:SubProcess') && this.expandedIds.has(element.id),
      child: null
    };
  }

  getParticipantContainerBounds(process, layout) {
    const extents = getParticipantContentExtents(layout);
    const hasLanes = flattenLanes(process.laneSets || []).length > 0;
    const leadingPadding = hasLanes ? PARTICIPANT_HEADER_WIDTH : SUB_PROCESS_PADDING;
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

  placeExpandedChildren(records) {
    for (const record of records) {
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
  }

  placeEventSubProcesses(records, layout) {
    const eventSubProcesses = records.filter(record => {
      return is(record.element, 'bpmn:SubProcess') && record.element.triggeredByEvent;
    });

    if (!eventSubProcesses.length) {
      return;
    }

    let nextEventSubProcessY = getExtents(layout).maxY + VERTICAL_GAP;

    for (const record of eventSubProcesses) {
      if (!record.expanded) {
        record.bounds = bounds(0, nextEventSubProcessY, record.size.width, record.size.height);
        layout.shapes.set(record.element, record.bounds);
        nextEventSubProcessY += record.size.height + VERTICAL_GAP;
        continue;
      }

      const extents = getExtents(record.child);
      const width = Math.max(MIN_SUB_PROCESS_WIDTH, extents.width + 2 * SUB_PROCESS_PADDING);
      const height = Math.max(MIN_SUB_PROCESS_HEIGHT, extents.height + 2 * SUB_PROCESS_PADDING);

      record.bounds = bounds(0, nextEventSubProcessY, width, height);
      layout.shapes.set(record.element, record.bounds);
      translateLayout(
        record.child,
        record.bounds.x + SUB_PROCESS_PADDING - extents.minX,
        record.bounds.y + SUB_PROCESS_PADDING - extents.minY
      );
      record.child.emitInParent = true;
      nextEventSubProcessY += height + VERTICAL_GAP;
    }

  }

  placeArtifacts(records, associations, layout, additionalBoundaryContainers = []) {
    const artifactRecords = records.filter(record => record.isArtifact);
    const graphShapes = new Map([
      ...layout.shapes,
      ...getExpandedChildShapes(layout)
    ]);
    const graphElements = new Set(graphShapes.keys());
    const owners = new Map();
    const graphObstacles = [ ...graphShapes.entries() ].filter(([ element ]) => {
      return !is(element, 'bpmn:Lane') &&
        !is(element, 'bpmn:Participant') &&
        !isArtifact(element);
    }).map(([ element, rect ]) => ({ element, rect }));
    const graphExtents = getShapeExtents(graphObstacles);
    const placementExtents = getShapeExtents([ ...graphShapes.entries() ]
      .filter(([ element ]) => !isArtifact(element))
      .map(([ element, rect ]) => ({ element, rect })));
    const graphRoutes = [
      ...layout.edges.entries(),
      ...getExpandedChildEdges(layout)
    ]
      .filter(([ element ]) => {
        return is(element, 'bpmn:SequenceFlow') || is(element, 'bpmn:MessageFlow');
      })
      .map(([ element, points ]) => ({ element, points }));
    const currentArtifacts = new Set(artifactRecords.map(record => record.element));
    const placedArtifacts = [ ...graphShapes.entries() ]
      .filter(([ element ]) => {
        return isArtifact(element) && !currentArtifacts.has(element);
      })
      .map(([ element, rect ]) => ({
        element,
        rect,
        annotationClearance: 0
      }));

    for (const association of associations) {
      const endpoints = [
        ...(Array.isArray(association.sourceRef) ? association.sourceRef : [ association.sourceRef ]),
        association.targetRef
      ];
      const artifact = endpoints.find(endpoint => artifactRecords.some(record => record.element === endpoint));
      const owner = is(association, 'bpmn:DataAssociation')
        ? association.$parent
        : endpoints.find(endpoint => endpoint !== artifact && graphElements.has(endpoint));

      if (!artifact || !owner || !graphElements.has(owner)) {
        continue;
      }

      if (!owners.has(artifact)) {
        owners.set(artifact, []);
      }

      owners.get(artifact).push({
        association,
        owner,
        ownerBounds: graphShapes.get(owner)
      });
    }

    artifactRecords.sort((a, b) => {
      const aReferences = owners.get(a.element)?.length || 0;
      const bReferences = owners.get(b.element)?.length || 0;
      const aArea = artifactSizeCandidates(a.element)[0];
      const bArea = artifactSizeCandidates(b.element)[0];

      return bReferences - aReferences ||
        bArea.width * bArea.height - aArea.width * aArea.height ||
        a.index - b.index;
    });

    for (const record of artifactRecords) {
      const references = owners.get(record.element) || [];
      const ownerBounds = references.length
        ? graphShapes.get(references[0].owner)
        : null;
      const owner = references[0]?.owner;
      const enclosingSubProcesses = ownerBounds
        ? [ ...graphShapes.entries() ].filter(([ element, rect ]) => {
          const centerX = ownerBounds.x + ownerBounds.width / 2;
          const centerY = ownerBounds.y + ownerBounds.height / 2;

          return element !== owner &&
            is(element, 'bpmn:SubProcess') &&
            centerX >= rect.x &&
            centerX <= rect.x + rect.width &&
            centerY >= rect.y &&
            centerY <= rect.y + rect.height;
        })
        : [];
      const subProcessContainer = enclosingSubProcesses
        .map(([ , rect ]) => rect)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0];
      const containingContainers = ownerBounds
        ? findContainingArtifactContainers(ownerBounds, graphShapes)
        : [];
      const container = containingContainers[0];
      const boundaryContainers = [
        ...additionalBoundaryContainers,
        ...[ ...graphShapes.entries() ]
          .filter(([ element ]) => {
            return is(element, 'bpmn:Lane') ||
              is(element, 'bpmn:Participant') ||
              is(element, 'bpmn:SubProcess');
          })
          .map(([ element, rect ]) => ({
            rect,
            containsOwner: containingContainers.includes(rect),
            participant: is(element, 'bpmn:Participant')
          }))
      ];
      const processContainer = subProcessContainer || (
        !container && isExteriorArtifact(record.element)
          ? bounds(
            graphExtents.minX - SUB_PROCESS_PADDING,
            graphExtents.minY - SUB_PROCESS_PADDING,
            graphExtents.width + 2 * SUB_PROCESS_PADDING,
            graphExtents.height + 2 * SUB_PROCESS_PADDING
          )
          : null
      );
      const annotationClearance = subProcessContainer &&
        is(record.element, 'bpmn:TextAnnotation')
        ? EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE
        : 0;
      const obstacles = graphObstacles.filter(({ element }) => {
        return !enclosingSubProcesses.some(([ subProcess ]) => subProcess === element);
      });
      const placement = findArtifactPlacement(
        record.element,
        ownerBounds,
        references,
        artifactSizeCandidates(record.element),
        obstacles,
        graphRoutes,
        placedArtifacts,
        container,
        processContainer,
        placementExtents,
        annotationClearance,
        boundaryContainers
      );

      record.size = { width: placement.width, height: placement.height };
      layout.shapes.set(record.element, placement);
      placedArtifacts.push({
        element: record.element,
        rect: placement,
        annotationClearance
      });
    }

    for (const record of artifactRecords) {
      const artifactBounds = layout.shapes.get(record.element);
      const references = owners.get(record.element) || [];

      for (const { association, owner } of references) {
        layout.edges.set(association, routeArtifactAssociation(
          association,
          owner,
          graphShapes.get(owner),
          record.element,
          artifactBounds
        ));
      }
    }

  }

  routeSequenceFlows(sequenceFlows, layout, policy) {
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
  }

  emitDiagram(definitions, root, layout) {
    const plane = this.diFactory.createDiPlane({
      id: `BPMNPlane_${root.id}`,
      bpmnElement: root,
      planeElement: []
    });
    const diagram = this.diFactory.createDiDiagram({
      id: `BPMNDiagram_${root.id}`,
      plane
    });

    definitions.diagrams.push(diagram);
    emitLayout(this.diFactory, layout, plane.planeElement);
    orientPlaneDockings(this.diFactory, plane.planeElement);
    layoutExternalLabels(this.diFactory, plane.planeElement);
  }

  emitCollapsedSubProcessDiagrams(definitions, layout) {
    for (const child of layout.children) {
      if (child.emitInParent) {
        this.emitCollapsedSubProcessDiagrams(definitions, child);
        continue;
      }

      normalizeLayout(child);
      const plane = this.diFactory.createDiPlane({
        id: `BPMNPlane_${child.scope.id}`,
        bpmnElement: child.scope,
        planeElement: []
      });
      const diagram = this.diFactory.createDiDiagram({
        id: `BPMNDiagram_${child.scope.id}`,
        plane
      });

      definitions.diagrams.push(diagram);
      emitLayout(this.diFactory, child, plane.planeElement);
      layoutExternalLabels(this.diFactory, plane.planeElement);
      this.emitCollapsedSubProcessDiagrams(definitions, child);
    }
  }

  warnForMissingDi(root, definitions) {
    const shapeElements = new Set();
    const edgeElements = new Set();

    for (const diagram of definitions.diagrams) {
      for (const di of diagram.plane.planeElement) {
        if (di.$instanceOf('bpmndi:BPMNShape')) {
          shapeElements.add(di.bpmnElement);
        } else if (di.$instanceOf('bpmndi:BPMNEdge')) {
          edgeElements.add(di.bpmnElement);
        }
      }
    }

    for (const element of getExpectedDiElements(root)) {
      const isShape = isSupportedVisualElement(element);
      const emitted = isShape
        ? shapeElements.has(element)
        : edgeElements.has(element);

      if (emitted || this.warnings.some(warning => warning.elementId === element.id)) {
        continue;
      }

      this.warnings.push(new LayoutWarning(
        'DI_NOT_CREATED',
        element.id,
        `No BPMN DI was created for visual BPMN element "${ element.$type }".`
      ));
    }
  }
}

function compactParticipantRows(participants, participantShapes, participantLayouts) {
  let nextY = 0;
  let collapsedRow = [];
  let collapsedRowY = 0;

  for (const participant of participants) {
    const participantBounds = participantShapes.get(participant);
    const processLayout = participantLayouts.get(participant);

    if (processLayout) {
      const extents = getExtents(processLayout);
      const hasProcessGeometry = processLayout.shapes.size > 0;
      const footprintTop = hasProcessGeometry
        ? Math.min(0, extents.minY - participantBounds.y)
        : 0;
      const footprintBottom = hasProcessGeometry
        ? Math.max(participantBounds.height, extents.maxY - participantBounds.y)
        : participantBounds.height;
      const participantY = nextY - footprintTop;
      const dy = participantY - participantBounds.y;

      participantBounds.y = participantY;
      translateLayout(processLayout, 0, dy);
      nextY += footprintBottom - footprintTop + VERTICAL_GAP;
      collapsedRow = [];
      continue;
    }

    const fitsCurrentRow = collapsedRow.length && collapsedRow.every(rect => {
      return rect.x + rect.width + HORIZONTAL_GAP <= participantBounds.x ||
        participantBounds.x + participantBounds.width + HORIZONTAL_GAP <= rect.x;
    });

    if (fitsCurrentRow) {
      participantBounds.y = collapsedRowY;
      collapsedRow.push(participantBounds);
      continue;
    }

    participantBounds.y = nextY;
    collapsedRowY = nextY;
    collapsedRow = [ participantBounds ];
    nextY += participantBounds.height + VERTICAL_GAP;
  }
}

function getExpectedDiElements(root) {
  const elements = new Set();
  const scopes = new Set();

  const addIfExpected = element => {
    if (isSupportedVisualElement(element) || isSupportedVisualConnection(element)) {
      elements.add(element);
    }
  };

  const collectScope = scope => {
    if (scopes.has(scope)) {
      return;
    }

    scopes.add(scope);
    flattenLanes(scope.laneSets || []).forEach(addIfExpected);

    for (const element of scope.flowElements || []) {
      addIfExpected(element);

      for (const association of [
        ...(element.dataInputAssociations || []),
        ...(element.dataOutputAssociations || [])
      ]) {
        addIfExpected(association);
      }

      if (is(element, 'bpmn:SubProcess')) {
        collectScope(element);
      }
    }

    (scope.artifacts || []).forEach(addIfExpected);
  };

  if (is(root, 'bpmn:Collaboration')) {
    (root.participants || []).forEach(addIfExpected);
    (root.messageFlows || []).forEach(addIfExpected);
    (root.artifacts || []).forEach(addIfExpected);

    for (const participant of root.participants || []) {
      if (participant.processRef) {
        collectScope(participant.processRef);
      }
    }
  } else {
    collectScope(root);
  }

  return elements;
}
