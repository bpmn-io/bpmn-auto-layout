import { getDefaultSize, is } from '../../di/DiUtil.js';
import { placeArtifacts } from '../artifacts/index.js';
import { isArtifact } from '../bpmn/Predicates.js';
import {
  HORIZONTAL_GAP,
  VERTICAL_GAP
} from '../Constants.js';
import {
  bounds,
  createLayout,
  getExpandedChildEdges,
  getExpandedChildShapes,
  getExtents,
  hasParticipantContent,
  translateLayout
} from '../geometry/index.js';
import { layoutGroups } from '../groups/LayoutGroups.js';
import {
  createLayoutRecord,
  getParticipantContainerBounds,
  layoutProcessScope
} from '../process/index.js';
import { validateMessageFlows } from '../bpmn/Validation.js';
import {
  alignParticipantComponentsLeft,
  alignParticipantsHorizontally,
  assignMessageFlowChannelOffsets,
  getMessageObstacles,
  includeResizableParticipantMessageDocks,
  orderParticipantsByMessageFlow,
  routeMessageFlows,
  sizeAndPositionParticipantsFromMessageAnchors
} from './MessageFlowLayout.js';

export function layoutCollaboration(collaboration, { expandedIds = new Set() } = {}) {
  validateMessageFlows(collaboration.messageFlows || []);

  const warnings = [];
  const layout = createLayout(collaboration);
  const messageFlowEndpointDirections = collectMessageFlowEndpointDirections(
    collaboration.messageFlows || []
  );
  const participantLayouts = new Map();
  const anchorPositionedParticipants = new Set();
  const expandableParticipants = new Set();
  let nextParticipantY = 0;

  for (const participant of collaboration.participants || []) {
    const process = participant.processRef;

    if (!process) {
      const size = getDefaultSize(participant);

      layout.shapes.set(participant, bounds(
        0,
        0,
        size.width,
        size.height
      ));
      anchorPositionedParticipants.add(participant);
      expandableParticipants.add(participant);
      continue;
    }

    const processResult = layoutProcessScope(process, {
      expandedIds,
      participantProcess: true,
      messageFlowEndpointDirections
    });
    const processLayout = processResult.layout;
    const participantRect = getParticipantContainerBounds(
      process,
      processLayout
    );
    const dx = -participantRect.x;
    const dy = -participantRect.y;

    warnings.push(...processResult.warnings);
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

  const localShapes = collectCollaborationShapes(layout);
  const messageFlowChannelOffsets = assignMessageFlowChannelOffsets(
    collaboration,
    localShapes
  );

  sizeAndPositionParticipantsFromMessageAnchors(
    collaboration,
    layout.shapes,
    localShapes,
    messageFlowChannelOffsets,
    anchorPositionedParticipants,
    expandableParticipants
  );

  const participantOrder = orderParticipantsByMessageFlow(
    collaboration,
    layout.shapes,
    localShapes
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

  let collaborationShapes = collectCollaborationShapes(layout);
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

  collaborationShapes = collectCollaborationShapes(layout);
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

  collaborationShapes = collectCollaborationShapes(layout);
  routeCollaborationMessageFlows(
    collaboration,
    layout,
    collaborationShapes,
    messageFlowChannelOffsets,
    expandableParticipants
  );
  layoutCollaborationArtifacts(
    collaboration,
    layout,
    expandedIds,
    warnings
  );

  return { layout, warnings };
}

function collectMessageFlowEndpointDirections(messageFlows) {
  const directions = new Map();
  const addDirection = (element, direction) => {
    if (!directions.has(element)) {
      directions.set(element, new Set());
    }

    directions.get(element).add(direction);
  };

  for (const messageFlow of messageFlows) {
    addDirection(messageFlow.sourceRef, 'outgoing');
    addDirection(messageFlow.targetRef, 'incoming');
  }

  return directions;
}

function collectCollaborationShapes(layout) {
  return new Map([
    ...layout.shapes,
    ...getExpandedChildShapes(layout)
  ]);
}

function routeCollaborationMessageFlows(
    collaboration,
    layout,
    collaborationShapes,
    messageFlowChannelOffsets,
    expandableParticipants) {
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
}

function layoutCollaborationArtifacts(
    collaboration,
    layout,
    expandedIds,
    warnings) {
  const artifacts = collaboration.artifacts || [];
  const groups = artifacts.filter(element => is(element, 'bpmn:Group'));
  const records = artifacts
    .filter(element => isArtifact(element) && !is(element, 'bpmn:Group'))
    .map((element, index) => {
      return createLayoutRecord(element, index, expandedIds);
    });
  const associations = artifacts.filter(element => {
    return is(element, 'bpmn:Association');
  });

  placeArtifacts({
    records,
    associations,
    layout,
    reservedVerticalEndpointDirections: new Map(),
    avoidParticipantInterior: collaboration.participants.length === 1,
    preferParticipantSides: collaboration.participants.length !== 1
  });
  warnings.push(...layoutGroups(groups, layout));
}

function compactParticipantRows(
    participants,
    participantShapes,
    participantLayouts) {
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
        ? Math.max(
          participantBounds.height,
          extents.maxY - participantBounds.y
        )
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
