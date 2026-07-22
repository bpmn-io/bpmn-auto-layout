import { is } from '../di/DiUtil.js';
import { isArtifact } from './BpmnUtil.js';
import { VERTICAL_GAP, ROUTING_MARGIN, PARTICIPANT_HEADER_WIDTH, MESSAGE_FLOW_BEND_PENALTY, MESSAGE_FLOW_SIDE_OFFSET, MESSAGE_FLOW_CHANNEL_SPACING, MESSAGE_FLOW_CHANNEL_WIDTH_DIVISOR, MAX_EXHAUSTIVE_PARTICIPANT_COUNT, MESSAGE_FLOW_OBSTACLE_INSET } from './Constants.js';
import { point, bounds, directConnection, cleanPoints, inset, segmentEntersRect, compareScores, routeLength, toSegments, segmentsProperlyCross } from './LayoutUtil.js';
import { visibilityRoute, segmentIsClear, pathIsClear } from './SequenceFlowRouter.js';

export function routeMessageFlow(
    source,
    target,
    sourceBounds,
    targetBounds,
    collaboration,
    participantShapes,
    obstacles,
    routedConnections,
    channelOffset) {
  const sourceCenterY = sourceBounds.y + sourceBounds.height / 2;
  const targetCenterY = targetBounds.y + targetBounds.height / 2;

  if (sourceCenterY === targetCenterY) {
    return directConnection(sourceBounds, targetBounds);
  }

  const downward = targetCenterY > sourceCenterY;
  const start = point(
    sourceBounds.x + sourceBounds.width / 2,
    downward ? sourceBounds.y + sourceBounds.height : sourceBounds.y
  );
  const end = point(
    targetBounds.x + targetBounds.width / 2,
    downward ? targetBounds.y : targetBounds.y + targetBounds.height
  );
  const sourceParticipant = findEndpointParticipant(source, collaboration);
  const targetParticipant = findEndpointParticipant(target, collaboration);
  const sourceParticipantBounds = participantShapes.get(sourceParticipant);
  const targetParticipantBounds = participantShapes.get(targetParticipant);
  const participantRows = [ ...new Set(
    [ ...(collaboration.participants || []) ]
      .map(participant => participantShapes.get(participant).y)
      .sort((a, b) => a - b)
  ) ];
  const sourceIndex = participantRows.indexOf(sourceParticipantBounds?.y);
  const targetIndex = participantRows.indexOf(targetParticipantBounds?.y);

  if (!sourceParticipantBounds || !targetParticipantBounds ||
      sourceIndex === -1 || targetIndex === -1) {
    return visibilityRoute(start, end, obstacles, source, target, routedConnections) ||
      directConnection(sourceBounds, targetBounds);
  }

  const sourcePoolEdgeY = downward
    ? sourceParticipantBounds.y + sourceParticipantBounds.height
    : sourceParticipantBounds.y;
  const targetPoolEdgeY = downward
    ? targetParticipantBounds.y
    : targetParticipantBounds.y + targetParticipantBounds.height;
  const sourceObstacles = obstacles.filter(({ rect }) => centerIsInside(rect, sourceParticipantBounds));
  const targetObstacles = obstacles.filter(({ rect }) => centerIsInside(rect, targetParticipantBounds));
  const sourceIsParticipant = source === sourceParticipant;
  const targetIsParticipant = target === targetParticipant;
  const sourceDockX = findMessageFlowDockX(
    sourceBounds,
    downward,
    true,
    sourceIsParticipant ? 0 : channelOffset,
    obstacles,
    source,
    target,
    routedConnections
  );
  const targetDockX = findMessageFlowDockX(
    targetBounds,
    downward,
    false,
    targetIsParticipant ? 0 : channelOffset,
    obstacles,
    source,
    target,
    routedConnections
  );

  start.x = sourceDockX;
  end.x = targetDockX;

  if (sourceIsParticipant && !targetIsParticipant) {
    start.x = constrainParticipantDockX(targetDockX, sourceParticipantBounds);
  } else if (targetIsParticipant && !sourceIsParticipant) {
    end.x = constrainParticipantDockX(sourceDockX, targetParticipantBounds);
  } else if (sourceIsParticipant && targetIsParticipant) {
    const overlapCenter = (
      Math.max(sourceParticipantBounds.x, targetParticipantBounds.x) +
      Math.min(
        sourceParticipantBounds.x + sourceParticipantBounds.width,
        targetParticipantBounds.x + targetParticipantBounds.width
      )
    ) / 2 + channelOffset;

    start.x = overlapCenter;
    end.x = overlapCenter;
  }

  if ((sourceIsParticipant || targetIsParticipant) && start.x === end.x) {

    if (segmentIsClear(start, end, obstacles, source, target, [])) {
      return [ start, end ];
    }

    const verticalBypass = findMessageFlowVerticalBypass(
      source,
      target,
      sourceBounds,
      targetBounds,
      sourceIsParticipant,
      targetIsParticipant,
      start,
      end,
      obstacles,
      channelOffset
    );

    if (verticalBypass) {
      return verticalBypass;
    }

    const localBypass = visibilityRoute(start, end, obstacles, source, target, []);

    if (localBypass) {
      return localBypass;
    }
  } else if (start.x === end.x &&
      segmentIsClear(start, end, obstacles, source, target, [])) {
    return [ start, end ];
  }

  if (Math.abs(sourceIndex - targetIndex) === 1) {
    const channelY = Math.round((sourcePoolEdgeY + targetPoolEdgeY) / 2);
    const sourceChannel = point(start.x, channelY);
    const targetChannel = point(end.x, channelY);

    return cleanPoints([
      ...routeMessageLeg(start, sourceChannel, sourceObstacles, source, target, routedConnections),
      targetChannel,
      ...routeMessageLeg(targetChannel, end, targetObstacles, source, target, routedConnections).slice(1)
    ]);
  }

  const direction = downward ? 1 : -1;
  const sourceChannelY = sourcePoolEdgeY + direction * ROUTING_MARGIN;
  const targetChannelY = targetPoolEdgeY - direction * ROUTING_MARGIN;
  const outsideX = Math.max(
    ...[ ...participantShapes.values() ].map(rect => rect.x + rect.width)
  ) + ROUTING_MARGIN;
  const sourceChannel = point(start.x, sourceChannelY);
  const targetChannel = point(end.x, targetChannelY);

  return cleanPoints([
    ...routeMessageLeg(start, sourceChannel, sourceObstacles, source, target, routedConnections),
    point(outsideX, sourceChannelY),
    point(outsideX, targetChannelY),
    targetChannel,
    ...routeMessageLeg(targetChannel, end, targetObstacles, source, target, routedConnections).slice(1)
  ]);
}

export function alignParticipantsHorizontally(
    collaboration,
    participantShapes,
    endpointShapes,
    connectionRoutes,
    channelOffsets,
    anchorPositionedParticipants,
    expandableParticipants) {
  const participants = collaboration.participants || [];
  const movableParticipants = participants.filter(participant => participant.processRef);
  const initialPositions = new Map(movableParticipants.map(participant => {
    return [ participant, participantShapes.get(participant).x ];
  }));
  const positions = new Map(initialPositions);
  const endpointRecords = (collaboration.messageFlows || []).map(messageFlow => {
    const source = resolveMessageFlowEndpoint(messageFlow.sourceRef, endpointShapes);
    const target = resolveMessageFlowEndpoint(messageFlow.targetRef, endpointShapes);
    const sourceParticipant = findEndpointParticipant(source, collaboration);
    const targetParticipant = findEndpointParticipant(target, collaboration);

    return {
      messageFlow,
      source,
      target,
      sourceParticipant,
      targetParticipant
    };
  }).filter(record => {
    return record.source &&
        record.target &&
        !is(record.source, 'bpmn:Participant') &&
        !is(record.target, 'bpmn:Participant') &&
        initialPositions.has(record.sourceParticipant) &&
        initialPositions.has(record.targetParticipant) &&
        record.sourceParticipant !== record.targetParticipant;
  });

  if (!endpointRecords.length) {
    return positions;
  }

  const localCenters = new Map();

  for (const { source, target, sourceParticipant, targetParticipant } of endpointRecords) {
    localCenters.set(
      source,
      getLocalCenterX(source, sourceParticipant, endpointShapes, participantShapes)
    );
    localCenters.set(
      target,
      getLocalCenterX(target, targetParticipant, endpointShapes, participantShapes)
    );
  }

  let currentScore = horizontalAlignmentScore(
    positions,
    initialPositions,
    collaboration,
    participantShapes,
    endpointShapes,
    connectionRoutes,
    channelOffsets,
    anchorPositionedParticipants,
    expandableParticipants
  );
  let changed;

  do {
    changed = false;

    for (const participant of movableParticipants) {
      const candidates = [ positions.get(participant) ];

      for (const record of endpointRecords) {
        if (record.sourceParticipant === participant) {
          candidates.push(
            Math.round(
              positions.get(record.targetParticipant) +
              localCenters.get(record.target) -
              localCenters.get(record.source)
            )
          );
        } else if (record.targetParticipant === participant) {
          candidates.push(
            Math.round(
              positions.get(record.sourceParticipant) +
              localCenters.get(record.source) -
              localCenters.get(record.target)
            )
          );
        }
      }

      let bestPosition = positions.get(participant);
      let bestScore = currentScore;

      for (const candidate of [ ...new Set(candidates) ]) {
        if (candidate === positions.get(participant)) {
          continue;
        }

        const candidatePositions = new Map(positions);

        candidatePositions.set(participant, candidate);

        const candidateScore = horizontalAlignmentScore(
          candidatePositions,
          initialPositions,
          collaboration,
          participantShapes,
          endpointShapes,
          connectionRoutes,
          channelOffsets,
          anchorPositionedParticipants,
          expandableParticipants
        );

        if (
          candidateScore[0] < currentScore[0] &&
          candidateScore[1] <= currentScore[1] &&
          compareScores(candidateScore, bestScore) < 0
        ) {
          bestPosition = candidate;
          bestScore = candidateScore;
        }
      }

      if (bestPosition !== positions.get(participant)) {
        positions.set(participant, bestPosition);
        currentScore = bestScore;
        changed = true;
      }
    }
  } while (changed);

  return positions;
}

export function alignParticipantComponentsLeft(collaboration, participantShapes) {
  const participants = collaboration.participants || [];

  if (participants.length < 2) {
    return new Map();
  }

  const neighbors = new Map(participants.map(participant => {
    return [ participant, new Set() ];
  }));

  for (const messageFlow of collaboration.messageFlows || []) {
    const source = findEndpointParticipant(messageFlow.sourceRef, collaboration);
    const target = findEndpointParticipant(messageFlow.targetRef, collaboration);

    if (!neighbors.has(source) || !neighbors.has(target) || source === target) {
      continue;
    }

    neighbors.get(source).add(target);
    neighbors.get(target).add(source);
  }

  const targetX = Math.min(...participants.map(participant => {
    return participantShapes.get(participant).x;
  }));
  const offsets = new Map();
  const visited = new Set();

  for (const participant of participants) {
    if (visited.has(participant)) {
      continue;
    }

    const component = [];
    const queue = [ participant ];

    visited.add(participant);

    while (queue.length) {
      const current = queue.shift();

      component.push(current);

      for (const neighbor of neighbors.get(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const componentX = Math.min(...component.map(member => {
      return participantShapes.get(member).x;
    }));
    const dx = targetX - componentX;

    for (const member of component) {
      offsets.set(member, dx);
    }
  }

  return offsets;
}

function getLocalCenterX(element, participant, endpointShapes, participantShapes) {
  const rect = endpointShapes.get(element);
  const participantBounds = participantShapes.get(participant);

  return rect.x + rect.width / 2 - participantBounds.x;
}

function horizontalAlignmentScore(
    positions,
    initialPositions,
    collaboration,
    participantShapes,
    endpointShapes,
    connectionRoutes,
    channelOffsets,
    anchorPositionedParticipants,
    expandableParticipants) {
  const translatedShapes = new Map([ ...endpointShapes ].map(([ element, rect ]) => {
    const participant = findEndpointParticipant(element, collaboration);
    const dx = positions.has(participant)
      ? positions.get(participant) - initialPositions.get(participant)
      : 0;

    return [
      element,
      bounds(rect.x + dx, rect.y, rect.width, rect.height)
    ];
  }));
  const translatedParticipants = new Map((collaboration.participants || []).map(participant => {
    return [ participant, translatedShapes.get(participant) ];
  }));

  sizeAndPositionParticipantsFromMessageAnchors(
    collaboration,
    translatedParticipants,
    translatedShapes,
    channelOffsets,
    anchorPositionedParticipants,
    expandableParticipants
  );

  const obstacles = getMessageObstacles(translatedShapes);
  const routes = routeMessageFlows(
    collaboration,
    translatedParticipants,
    translatedShapes,
    obstacles,
    channelOffsets
  );
  const routingCost = [ ...routes.values() ].reduce((total, points) => {
    const bendCost = points.length > 2 ? MESSAGE_FLOW_BEND_PENALTY : 0;

    return total + routeLength(points) + bendCost;
  }, 0);
  const bendCount = [ ...routes.values() ].filter(points => points.length > 2).length;
  const translatedConnections = connectionRoutes.map(([ element, points ]) => {
    const participant = findEndpointParticipant(element, collaboration);
    const dx = positions.has(participant)
      ? positions.get(participant) - initialPositions.get(participant)
      : 0;

    return points.map(routePoint => point(routePoint.x + dx, routePoint.y));
  });
  const crossingCount = countRouteCrossings([
    ...translatedConnections,
    ...routes.values()
  ]);
  const displacement = [ ...positions ].reduce((total, [ participant, x ]) => {
    return total + Math.abs(x - initialPositions.get(participant));
  }, 0);

  return [ bendCount, crossingCount, routingCost, displacement ];
}

function countRouteCrossings(routes) {
  const segments = routes.map(toSegments);
  let crossings = 0;

  for (let first = 0; first < segments.length; first++) {
    for (let second = first + 1; second < segments.length; second++) {
      for (const [ a, b ] of segments[first]) {
        crossings += segments[second].filter(([ c, d ]) => {
          return segmentsProperlyCross(a, b, c, d);
        }).length;
      }
    }
  }

  return crossings;
}

export function getMessageObstacles(shapes) {
  return [ ...shapes ]
    .filter(([ element ]) => {
      return !is(element, 'bpmn:Lane') &&
          !is(element, 'bpmn:Participant') &&
          !is(element, 'bpmn:SubProcess') &&
          !isArtifact(element);
    })
    .map(([ element, rect ]) => ({ element, rect }));
}

export function routeMessageFlows(
    collaboration,
    participantShapes,
    endpointShapes,
    obstacles,
    channelOffsets) {
  const routes = new Map();
  const routedConnections = [];

  for (const messageFlow of collaboration.messageFlows || []) {
    const source = resolveMessageFlowEndpoint(messageFlow.sourceRef, endpointShapes);
    const target = resolveMessageFlowEndpoint(messageFlow.targetRef, endpointShapes);
    const sourceBounds = endpointShapes.get(source);
    const targetBounds = endpointShapes.get(target);

    if (!sourceBounds || !targetBounds) {
      continue;
    }

    const points = routeMessageFlow(
      source,
      target,
      sourceBounds,
      targetBounds,
      collaboration,
      participantShapes,
      obstacles,
      routedConnections,
      channelOffsets.get(messageFlow) || 0
    );

    routes.set(messageFlow, points);
    routedConnections.push({ flow: messageFlow, points });
  }

  return routes;
}

function findMessageFlowDockX(
    endpointBounds,
    downward,
    source,
    offset,
    obstacles,
    sourceElement,
    targetElement,
    routedConnections) {
  const inset = Math.min(ROUTING_MARGIN, endpointBounds.width / 2);
  const minX = endpointBounds.x + inset;
  const maxX = endpointBounds.x + endpointBounds.width - inset;
  const centerX = endpointBounds.x + endpointBounds.width / 2;
  const preferredX = Math.max(minX, Math.min(centerX + offset, maxX));
  const candidates = [
    preferredX,
    centerX,
    minX,
    maxX
  ].filter((candidate, index, values) => values.indexOf(candidate) === index);
  const dockY = source === downward
    ? endpointBounds.y + endpointBounds.height
    : endpointBounds.y;
  const outsideY = dockY + (source === downward ? ROUTING_MARGIN : -ROUTING_MARGIN);

  return candidates.find(candidate => {
    return segmentIsClear(
      point(candidate, dockY),
      point(candidate, outsideY),
      obstacles,
      sourceElement,
      targetElement,
      routedConnections
    );
  }) || preferredX;
}

function findMessageFlowVerticalBypass(
    source,
    target,
    sourceBounds,
    targetBounds,
    sourceIsParticipant,
    targetIsParticipant,
    start,
    end,
    obstacles,
    channelOffset) {
  if (sourceIsParticipant === targetIsParticipant) {
    return null;
  }

  const nodeBounds = sourceIsParticipant ? targetBounds : sourceBounds;
  const outgoing = !sourceIsParticipant;
  const participantY = sourceIsParticipant ? start.y : end.y;
  const participantAbove = participantY < nodeBounds.y + nodeBounds.height / 2;
  const dockY = participantAbove ? nodeBounds.y : nodeBounds.y + nodeBounds.height;
  const leadY = dockY + (participantAbove ? -ROUTING_MARGIN : ROUTING_MARGIN);
  const preferredSide = channelOffset || (outgoing ? MESSAGE_FLOW_SIDE_OFFSET : -MESSAGE_FLOW_SIDE_OFFSET);
  const sides = [
    {
      offset: MESSAGE_FLOW_SIDE_OFFSET,
      channelX: nodeBounds.x + nodeBounds.width + ROUTING_MARGIN
    },
    {
      offset: -MESSAGE_FLOW_SIDE_OFFSET,
      channelX: nodeBounds.x - ROUTING_MARGIN
    }
  ].sort((a, b) => {
    return Math.abs(a.offset - preferredSide) - Math.abs(b.offset - preferredSide);
  });

  for (const { channelX } of sides) {
    const dockX = nodeBounds.x + nodeBounds.width / 2 + channelOffset;
    const dock = point(dockX, dockY);
    const lead = point(dockX, leadY);
    const channel = point(channelX, leadY);
    const participantDock = point(channelX, sourceIsParticipant ? start.y : end.y);
    const candidate = sourceIsParticipant
      ? [ participantDock, channel, lead, dock ]
      : [ dock, lead, channel, participantDock ];

    if (pathIsClear(candidate, obstacles, source, target, [])) {
      return candidate;
    }
  }

  return null;
}

function centerIsInside(rect, container) {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;

  return x >= container.x &&
    x <= container.x + container.width &&
    y >= container.y &&
    y <= container.y + container.height;
}

function routeMessageLeg(start, end, obstacles, source, target, routedConnections) {
  if (segmentIsClear(start, end, obstacles, source, target, routedConnections)) {
    return [ start, end ];
  }

  return visibilityRoute(start, end, obstacles, source, target, routedConnections) ||
    visibilityRoute(start, end, obstacles, source, target, []) ||
    [ start, end ];
}

export function sizeAndPositionParticipantsFromMessageAnchors(
    collaboration,
    participantShapes,
    endpointShapes,
    channelOffsets,
    anchorPositionedParticipants,
    expandableParticipants) {
  const participants = collaboration.participants || [];
  const anchorPositioned = participants.filter(participant => {
    return anchorPositionedParticipants.has(participant);
  });
  const anchors = new Map(anchorPositioned.map(participant => [ participant, [] ]));
  const participantConnections = [];

  for (const messageFlow of collaboration.messageFlows || []) {
    const source = resolveMessageFlowEndpoint(messageFlow.sourceRef, endpointShapes);
    const target = resolveMessageFlowEndpoint(messageFlow.targetRef, endpointShapes);
    const offset = channelOffsets.get(messageFlow) || 0;

    if (anchors.has(source) && !is(target, 'bpmn:Participant')) {
      const targetBounds = endpointShapes.get(target);

      anchors.get(source).push(targetBounds.x + targetBounds.width / 2 + offset);
    }
    if (anchors.has(target) && !is(source, 'bpmn:Participant')) {
      const sourceBounds = endpointShapes.get(source);

      anchors.get(target).push(sourceBounds.x + sourceBounds.width / 2 + offset);
    }
    if (
      is(source, 'bpmn:Participant') &&
      is(target, 'bpmn:Participant') &&
      (anchors.has(source) || anchors.has(target))
    ) {
      participantConnections.push([ source, target ]);
    }
  }

  const positioned = new Set(participants.filter(participant => {
    return !anchorPositionedParticipants.has(participant);
  }));

  for (const participant of anchorPositioned) {
    const participantAnchors = anchors.get(participant);

    if (!participantAnchors.length) {
      continue;
    }

    const participantBounds = participantShapes.get(participant);
    const anchorsFitCurrentBounds = participantAnchors.every(anchor => {
      return anchor >= participantBounds.x + PARTICIPANT_HEADER_WIDTH &&
        anchor <= participantBounds.x + participantBounds.width - PARTICIPANT_HEADER_WIDTH;
    });

    if (participant.processRef && anchorsFitCurrentBounds) {
      positioned.add(participant);
      continue;
    }

    const min = Math.min(...participantAnchors);
    const max = Math.max(...participantAnchors);
    const width = Math.max(
      participantBounds.width,
      expandableParticipants.has(participant)
        ? max - min + 2 * PARTICIPANT_HEADER_WIDTH
        : 0
    );
    const center = (min + max) / 2;

    participantBounds.x = Math.round(center - width / 2);
    participantBounds.width = Math.round(width);
    positioned.add(participant);
  }

  let changed = true;

  while (changed) {
    changed = false;

    for (const participant of anchorPositioned) {
      if (positioned.has(participant)) {
        continue;
      }

      const neighbors = participantConnections.flatMap(([ source, target ]) => {
        if (source === participant && positioned.has(target)) {
          return [ target ];
        }
        if (target === participant && positioned.has(source)) {
          return [ source ];
        }
        return [];
      });

      if (!neighbors.length) {
        continue;
      }

      const center = neighbors.reduce((sum, neighbor) => {
        const neighborBounds = participantShapes.get(neighbor);

        return sum + neighborBounds.x + neighborBounds.width / 2;
      }, 0) / neighbors.length;
      const participantBounds = participantShapes.get(participant);

      participantBounds.x = Math.round(center - participantBounds.width / 2);
      positioned.add(participant);
      changed = true;
    }
  }

  for (const [ source, target ] of participantConnections) {
    ensureParticipantDockOverlap(
      participantShapes.get(source),
      participantShapes.get(target),
      expandableParticipants.has(source),
      expandableParticipants.has(target)
    );
  }
}

export function includeResizableParticipantMessageDocks(
    collaboration,
    participantShapes,
    edges,
    expandableParticipants) {
  let changed = false;

  for (const messageFlow of collaboration.messageFlows || []) {
    const points = edges.get(messageFlow);

    if (!points?.length) {
      continue;
    }

    for (const [ endpoint, dock ] of [
      [ messageFlow.sourceRef, points[0] ],
      [ messageFlow.targetRef, points.at(-1) ]
    ]) {
      if (!is(endpoint, 'bpmn:Participant') || !expandableParticipants.has(endpoint)) {
        continue;
      }

      const participantBounds = participantShapes.get(endpoint);
      const previousX = participantBounds.x;
      const previousWidth = participantBounds.width;

      includeHorizontalRange(
        participantBounds,
        dock.x - PARTICIPANT_HEADER_WIDTH,
        dock.x + PARTICIPANT_HEADER_WIDTH
      );

      changed = changed ||
        participantBounds.x !== previousX ||
        participantBounds.width !== previousWidth;
    }
  }

  return changed;
}

function constrainParticipantDockX(x, participantBounds) {
  return Math.max(
    participantBounds.x + PARTICIPANT_HEADER_WIDTH,
    Math.min(
      x,
      participantBounds.x + participantBounds.width - PARTICIPANT_HEADER_WIDTH
    )
  );
}

function ensureParticipantDockOverlap(
    source,
    target,
    sourceResizable = true,
    targetResizable = true) {
  const sourceRight = source.x + source.width;
  const targetRight = target.x + target.width;
  const overlapStart = Math.max(source.x, target.x);
  const overlapEnd = Math.min(sourceRight, targetRight);

  if (overlapEnd - overlapStart >= 2 * ROUTING_MARGIN) {
    return;
  }

  if (sourceResizable !== targetResizable) {
    const mutable = sourceResizable ? source : target;
    const fixed = sourceResizable ? target : source;
    const fixedRight = fixed.x + fixed.width;
    const mutableCenter = mutable.x + mutable.width / 2;
    const channelX = Math.max(
      fixed.x + ROUTING_MARGIN,
      Math.min(mutableCenter, fixedRight - ROUTING_MARGIN)
    );

    includeHorizontalRange(
      mutable,
      channelX - ROUTING_MARGIN,
      channelX + ROUTING_MARGIN
    );
    return;
  }

  const channelX = Math.round((overlapStart + overlapEnd) / 2);
  const dockStart = channelX - ROUTING_MARGIN;
  const dockEnd = channelX + ROUTING_MARGIN;

  if (sourceResizable) {
    includeHorizontalRange(source, dockStart, dockEnd);
  }
  if (targetResizable) {
    includeHorizontalRange(target, dockStart, dockEnd);
  }
}

function includeHorizontalRange(bounds, min, max) {
  const right = bounds.x + bounds.width;

  bounds.x = Math.min(bounds.x, min);
  bounds.width = Math.max(right, max) - bounds.x;
}

export function assignMessageFlowChannelOffsets(collaboration, shapes) {
  const groups = new Map();
  const offsets = new Map();

  for (const messageFlow of collaboration.messageFlows || []) {
    const source = resolveMessageFlowEndpoint(messageFlow.sourceRef, shapes);
    const target = resolveMessageFlowEndpoint(messageFlow.targetRef, shapes);
    const sourceId = source.id;
    const targetId = target.id;
    const key = [ sourceId, targetId ].sort().join(':');

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push({ messageFlow, source, target });
  }

  for (const flows of groups.values()) {
    const first = flows[0];
    const forward = flows.filter(flow => {
      return flow.source === first.source && flow.target === first.target;
    });
    const reverse = flows.filter(flow => {
      return flow.source === first.target && flow.target === first.source;
    });

    if (!forward.length || !reverse.length) {
      continue;
    }

    const node = is(first.source, 'bpmn:Participant')
      ? first.target
      : first.source;
    const nodeBounds = shapes.get(node);
    const spacing = nodeBounds && !is(node, 'bpmn:Participant')
      ? Math.min(
        MESSAGE_FLOW_CHANNEL_SPACING,
        Math.floor(nodeBounds.width / MESSAGE_FLOW_CHANNEL_WIDTH_DIVISOR)
      )
      : MESSAGE_FLOW_CHANNEL_SPACING;
    const firstDirection = is(first.source, 'bpmn:Participant') &&
      !is(first.target, 'bpmn:Participant')
      ? 1
      : -1;

    forward.forEach((flow, index) => {
      offsets.set(flow.messageFlow, firstDirection * spacing * (index + 1));
    });
    reverse.forEach((flow, index) => {
      offsets.set(flow.messageFlow, -firstDirection * spacing * (index + 1));
    });
  }

  return offsets;
}

export function orderParticipantsByMessageFlow(collaboration, participantShapes, endpointShapes) {
  const participants = collaboration.participants || [];

  if (participants.length < 2) {
    return participants;
  }

  const scoreOrder = createMessageFlowOrderScorer(
    participants,
    collaboration,
    participantShapes,
    endpointShapes
  );

  if (participants.length <= MAX_EXHAUSTIVE_PARTICIPANT_COUNT) {
    let bestOrder = participants;
    let bestScore = null;
    const permute = (prefix, remaining) => {
      if (!remaining.length) {
        const score = scoreOrder(prefix);

        if (!bestScore || compareScores(score, bestScore) < 0) {
          bestOrder = [ ...prefix ];
          bestScore = score;
        }
        return;
      }

      for (let index = 0; index < remaining.length; index++) {
        permute(
          [ ...prefix, remaining[index] ],
          [ ...remaining.slice(0, index), ...remaining.slice(index + 1) ]
        );
      }
    };

    permute([], participants);
    return bestOrder;
  }

  let ordered = [ participants[0] ];

  for (const participant of participants.slice(1)) {
    let bestOrder;
    let bestScore = null;

    for (let index = 0; index <= ordered.length; index++) {
      const candidate = [
        ...ordered.slice(0, index),
        participant,
        ...ordered.slice(index)
      ];
      const score = scoreOrder(candidate);

      if (!bestScore || compareScores(score, bestScore) < 0) {
        bestOrder = candidate;
        bestScore = score;
      }
    }

    ordered = bestOrder;
  }

  let improved;

  do {
    improved = false;

    for (const participant of participants) {
      const currentIndex = ordered.indexOf(participant);
      const remaining = ordered.filter(candidate => candidate !== participant);
      let bestOrder = ordered;
      let bestScore = scoreOrder(ordered);

      for (let index = 0; index <= remaining.length; index++) {
        if (index === currentIndex) {
          continue;
        }

        const candidate = [
          ...remaining.slice(0, index),
          participant,
          ...remaining.slice(index)
        ];
        const score = scoreOrder(candidate);

        if (compareScores(score, bestScore) < 0) {
          bestOrder = candidate;
          bestScore = score;
        }
      }

      if (bestOrder !== ordered) {
        ordered = bestOrder;
        improved = true;
      }
    }
  } while (improved);

  return ordered;
}

function createMessageFlowOrderScorer(
    participants,
    collaboration,
    participantShapes,
    endpointShapes) {
  const context = createMessageFlowOrderContext(collaboration, endpointShapes);

  if (participants.length <= MAX_EXHAUSTIVE_PARTICIPANT_COUNT) {
    return order => messageFlowOrderScore(order, participantShapes, context);
  }

  const participantIndexes = new Map(
    participants.map((participant, index) => [ participant, index ])
  );
  const scores = new Map();

  return order => {
    const key = order.map(participant => participantIndexes.get(participant)).join(':');

    if (!scores.has(key)) {
      scores.set(key, messageFlowOrderScore(order, participantShapes, context));
    }

    return scores.get(key);
  };
}

function createMessageFlowOrderContext(collaboration, endpointShapes) {
  const participantsByProcess = new Map();

  for (const participant of collaboration.participants || []) {
    if (!participantsByProcess.has(participant.processRef)) {
      participantsByProcess.set(participant.processRef, participant);
    }
  }

  const messageFlows = (collaboration.messageFlows || []).map(messageFlow => {
    const source = resolveMessageFlowEndpoint(messageFlow.sourceRef, endpointShapes);
    const target = resolveMessageFlowEndpoint(messageFlow.targetRef, endpointShapes);

    return {
      source,
      target,
      sourceBounds: endpointShapes.get(source),
      targetBounds: endpointShapes.get(target),
      sourceParticipant: findEndpointParticipantCached(source, participantsByProcess),
      targetParticipant: findEndpointParticipantCached(target, participantsByProcess)
    };
  });
  const obstacles = [ ...endpointShapes.entries() ]
    .filter(([ element ]) => {
      return !is(element, 'bpmn:Participant') &&
        !is(element, 'bpmn:Lane') &&
        !is(element, 'bpmn:SubProcess');
    })
    .map(([ element, rect ]) => ({
      element,
      rect,
      participant: findEndpointParticipantCached(element, participantsByProcess)
    }));

  return {
    messageFlows,
    obstacles,
    prioritizeAdjacency: messageFlows.some(({
      sourceParticipant,
      targetParticipant
    }) => {
      return sourceParticipant &&
        targetParticipant &&
        !sourceParticipant.processRef &&
        !targetParticipant.processRef;
    })
  };
}

function messageFlowOrderScore(order, participantShapes, context) {
  const positions = new Map();
  const orderIndex = new Map(order.map((participant, index) => [ participant, index ]));
  const participantPairs = new Set();
  let y = 0;

  for (const participant of order) {
    positions.set(participant, y);
    y += participantShapes.get(participant).height + VERTICAL_GAP;
  }

  const geometryScore = context.messageFlows.reduce((total, messageFlow) => {
    const {
      source,
      target,
      sourceParticipant,
      targetParticipant
    } = messageFlow;

    if (!source || !target ||
        !positions.has(sourceParticipant) || !positions.has(targetParticipant)) {
      return total;
    }

    const sourceCenter = getOrderedEndpointCenterY(
      sourceParticipant,
      positions,
      messageFlow.sourceBounds
    );
    const targetCenter = getOrderedEndpointCenterY(
      targetParticipant,
      positions,
      messageFlow.targetBounds
    );
    const downward = targetCenter > sourceCenter;
    const sourceY = getOrderedEndpointDockY(
      sourceParticipant,
      downward,
      true,
      positions,
      messageFlow.sourceBounds
    );
    const targetY = getOrderedEndpointDockY(
      targetParticipant,
      downward,
      false,
      positions,
      messageFlow.targetBounds
    );
    const bendPenalty = orderedMessageFlowNeedsBend(
      messageFlow,
      sourceY,
      targetY,
      positions,
      context.obstacles
    ) ? MESSAGE_FLOW_BEND_PENALTY : 0;

    return total + bendPenalty + Math.abs(targetY - sourceY);
  }, 0);
  let adjacencyPenalty = 0;

  if (context.prioritizeAdjacency) {
    for (const {
      sourceParticipant: source,
      targetParticipant: target
    } of context.messageFlows) {

      if (!orderIndex.has(source) || !orderIndex.has(target) || source === target) {
        continue;
      }

      const sourceIndex = orderIndex.get(source);
      const targetIndex = orderIndex.get(target);
      const pair = sourceIndex < targetIndex
        ? `${source.id}:${target.id}`
        : `${target.id}:${source.id}`;

      if (!participantPairs.has(pair)) {
        participantPairs.add(pair);
        adjacencyPenalty += Math.max(0, Math.abs(sourceIndex - targetIndex) - 1);
      }
    }
  }

  return [ adjacencyPenalty, geometryScore ];
}

function getOrderedEndpointCenterY(participant, positions, endpointBounds) {
  return positions.get(participant) + endpointBounds.y + endpointBounds.height / 2;
}

function getOrderedEndpointDockY(
    participant,
    downward,
    source,
    positions,
    endpointBounds) {
  const top = positions.get(participant) + endpointBounds.y;
  const dockAtBottom = source ? downward : !downward;

  return dockAtBottom ? top + endpointBounds.height : top;
}

function orderedMessageFlowNeedsBend(
    messageFlow,
    sourceY,
    targetY,
    positions,
    obstacles) {
  const {
    source,
    target,
    sourceParticipant,
    targetParticipant,
    sourceBounds,
    targetBounds
  } = messageFlow;
  const sourceIsParticipant = source === sourceParticipant;
  const targetIsParticipant = target === targetParticipant;
  const sourceX = sourceBounds.x + sourceBounds.width / 2;
  const targetX = targetBounds.x + targetBounds.width / 2;
  const straightX = sourceIsParticipant && !targetIsParticipant
    ? targetX
    : targetIsParticipant && !sourceIsParticipant
      ? sourceX
      : sourceIsParticipant && targetIsParticipant
        ? sourceX
        : sourceX === targetX
          ? sourceX
          : null;

  if (straightX === null) {
    return true;
  }

  const start = point(straightX, sourceY);
  const end = point(straightX, targetY);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return obstacles.some(({ element, rect, participant }) => {
    if (element === source || element === target) {
      return false;
    }

    if (!positions.has(participant)) {
      return false;
    }

    const translated = bounds(
      rect.x,
      rect.y + positions.get(participant),
      rect.width,
      rect.height
    );
    const obstacle = inset(translated, MESSAGE_FLOW_OBSTACLE_INSET);
    const verticallyDisjoint = minY === maxY
      ? minY < obstacle.y || minY > obstacle.y + obstacle.height
      : maxY <= obstacle.y || minY >= obstacle.y + obstacle.height;

    if (start.x < obstacle.x ||
        start.x > obstacle.x + obstacle.width ||
        verticallyDisjoint) {
      return false;
    }

    return segmentEntersRect(start, end, obstacle);
  });
}

function findEndpointParticipant(endpoint, collaboration) {
  if (is(endpoint, 'bpmn:Participant')) {
    return endpoint;
  }

  const process = findEndpointProcess(endpoint);

  return (collaboration.participants || [])
    .find(participant => participant.processRef === process);
}

function findEndpointParticipantCached(endpoint, participantsByProcess) {
  if (is(endpoint, 'bpmn:Participant')) {
    return endpoint;
  }

  return participantsByProcess.get(findEndpointProcess(endpoint));
}

function findEndpointProcess(endpoint) {
  let parent = endpoint?.$parent;

  while (parent && !is(parent, 'bpmn:Process')) {
    parent = parent.$parent;
  }

  return parent;
}

export function resolveMessageFlowEndpoint(endpoint, shapes) {
  let visibleEndpoint = endpoint;

  while (visibleEndpoint && !shapes.has(visibleEndpoint)) {
    visibleEndpoint = visibleEndpoint.$parent;
  }

  return visibleEndpoint;
}
