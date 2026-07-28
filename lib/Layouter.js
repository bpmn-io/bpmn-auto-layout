import { BpmnModdle } from 'bpmn-moddle';

import { DiFactory } from './di/DiFactory.js';
import { getDefaultSize, is } from './di/DiUtil.js';
import { LayoutError } from './LayoutError.js';
import { LayoutWarning } from './LayoutWarning.js';
import { HORIZONTAL_GAP, VERTICAL_GAP } from './layout/Constants.js';
import {
  isArtifact,
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
  hasParticipantContent,
  getExpandedChildEdges,
  getExpandedChildShapes
} from './layout/LayoutUtil.js';
import {
  validateMessageFlows,
  validateInputVisuals,
  validateParseWarnings
} from './layout/Validation.js';
import { flattenLanes } from './layout/ShapePlacement.js';
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
import { layoutExternalLabels } from './layout/LabelLayouter.js';
import { layoutGroups } from './layout/GroupLayouter.js';
import { finalizeLayoutConnections } from './layout/ConnectionDocking.js';
import { placeArtifacts } from './layout/ArtifactLayoutStage.js';
import {
  createLayoutRecord,
  getParticipantContainerBounds,
  layoutProcessScope
} from './layout/ProcessLayoutPipeline.js';
import { emitLayout } from './di/LayoutEmitter.js';

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
    let layout;

    if (is(root, 'bpmn:Collaboration')) {
      layout = this.layoutCollaboration(root);
    } else {
      const result = layoutProcessScope(root, { expandedIds: this.expandedIds });

      layout = result.layout;
      this.warnings.push(...result.warnings);
    }

    normalizeLayout(layout);
    finalizeLayoutConnections(layout, true);
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
    const messageFlowEndpointDirections = new Map();
    const addMessageFlowDirection = (element, direction) => {
      if (!messageFlowEndpointDirections.has(element)) {
        messageFlowEndpointDirections.set(element, new Set());
      }

      messageFlowEndpointDirections.get(element).add(direction);
    };

    for (const messageFlow of collaboration.messageFlows || []) {
      addMessageFlowDirection(messageFlow.sourceRef, 'outgoing');
      addMessageFlowDirection(messageFlow.targetRef, 'incoming');
    }
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

      const processResult = layoutProcessScope(process, {
        expandedIds: this.expandedIds,
        participantProcess: true,
        messageFlowEndpointDirections
      });
      const processLayout = processResult.layout;
      const participantRect = getParticipantContainerBounds(process, processLayout);
      const dx = -participantRect.x;
      const dy = -participantRect.y;

      this.warnings.push(...processResult.warnings);
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
      .map((element, index) => createLayoutRecord(element, index, this.expandedIds));
    const associations = artifacts.filter(element => is(element, 'bpmn:Association'));

    placeArtifacts({
      records: artifactRecords,
      associations,
      layout,
      reservedVerticalEndpointDirections: new Map(),
      avoidParticipantInterior: collaboration.participants.length === 1,
      preferParticipantSides: collaboration.participants.length !== 1
    });
    this.warnings.push(...layoutGroups(groups, layout));

    return layout;
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
    layoutExternalLabels(this.diFactory, plane.planeElement);
  }

  emitCollapsedSubProcessDiagrams(definitions, layout) {
    for (const child of layout.children) {
      if (child.emitInParent) {
        this.emitCollapsedSubProcessDiagrams(definitions, child);
        continue;
      }

      normalizeLayout(child);
      finalizeLayoutConnections(child);
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
