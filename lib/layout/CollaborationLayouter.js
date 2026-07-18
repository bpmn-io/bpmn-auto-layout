import { is } from '../di/DiUtil.js';
import { VERTICAL_GAP, ROUTING_MARGIN, PARTICIPANT_HEADER_WIDTH, MIN_PARTICIPANT_WIDTH, MESSAGE_FLOW_BEND_PENALTY, MESSAGE_FLOW_SIDE_OFFSET, MESSAGE_FLOW_CHANNEL_SPACING, MESSAGE_FLOW_CHANNEL_WIDTH_DIVISOR, MAX_EXHAUSTIVE_PARTICIPANT_COUNT, MESSAGE_FLOW_OBSTACLE_INSET } from './Constants.js';
import { point, bounds, directConnection, cleanPoints, inset, segmentEntersRect, compareScores } from './LayoutUtil.js';
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
  const participants = [ ...(collaboration.participants || []) ].sort((a, b) => {
    return participantShapes.get(a).y - participantShapes.get(b).y;
  });
  const sourceIndex = participants.indexOf(sourceParticipant);
  const targetIndex = participants.indexOf(targetParticipant);

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
  const sourceDockX = sourceBounds.x + sourceBounds.width / 2 +
    (sourceIsParticipant ? 0 : channelOffset);
  const targetDockX = targetBounds.x + targetBounds.width / 2 +
    (targetIsParticipant ? 0 : channelOffset);

  start.x = sourceDockX;
  end.x = targetDockX;

  const straightX = sourceIsParticipant && !targetIsParticipant
    ? targetDockX
    : targetIsParticipant && !sourceIsParticipant
      ? sourceDockX
      : sourceIsParticipant && targetIsParticipant
        ? (
          Math.max(sourceParticipantBounds.x, targetParticipantBounds.x) +
          Math.min(
            sourceParticipantBounds.x + sourceParticipantBounds.width,
            targetParticipantBounds.x + targetParticipantBounds.width
          )
        ) / 2 + channelOffset
        : null;

  if (straightX !== null) {
    start.x = straightX;
    end.x = straightX;

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

export function sizeAndPositionCollapsedParticipants(
    collaboration,
    participantShapes,
    endpointShapes,
    channelOffsets) {
  const participants = collaboration.participants || [];
  const collapsed = participants.filter(participant => !participant.processRef);
  const anchors = new Map(collapsed.map(participant => [ participant, [] ]));
  const participantConnections = [];

  for (const messageFlow of collaboration.messageFlows || []) {
    const source = messageFlow.sourceRef;
    const target = messageFlow.targetRef;
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

  const positioned = new Set(participants.filter(participant => participant.processRef));

  for (const participant of collapsed) {
    const participantAnchors = anchors.get(participant);

    if (!participantAnchors.length) {
      continue;
    }

    const min = Math.min(...participantAnchors);
    const max = Math.max(...participantAnchors);
    const width = Math.max(
      MIN_PARTICIPANT_WIDTH,
      max - min + 2 * PARTICIPANT_HEADER_WIDTH
    );
    const center = (min + max) / 2;
    const participantBounds = participantShapes.get(participant);

    participantBounds.x = Math.round(center - width / 2);
    participantBounds.width = Math.round(width);
    positioned.add(participant);
  }

  let changed = true;

  while (changed) {
    changed = false;

    for (const participant of collapsed) {
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
      !source.processRef,
      !target.processRef
    );
  }
}

export function includeCollapsedParticipantMessageDocks(collaboration, participantShapes, edges) {
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
      if (!is(endpoint, 'bpmn:Participant') || endpoint.processRef) {
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
    const sourceId = messageFlow.sourceRef.id;
    const targetId = messageFlow.targetRef.id;
    const key = [ sourceId, targetId ].sort().join(':');

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(messageFlow);
  }

  for (const flows of groups.values()) {
    const first = flows[0];
    const forward = flows.filter(flow => {
      return flow.sourceRef === first.sourceRef && flow.targetRef === first.targetRef;
    });
    const reverse = flows.filter(flow => {
      return flow.sourceRef === first.targetRef && flow.targetRef === first.sourceRef;
    });

    if (!forward.length || !reverse.length) {
      continue;
    }

    const node = is(first.sourceRef, 'bpmn:Participant')
      ? first.targetRef
      : first.sourceRef;
    const nodeBounds = shapes.get(node);
    const spacing = nodeBounds && !is(node, 'bpmn:Participant')
      ? Math.min(
        MESSAGE_FLOW_CHANNEL_SPACING,
        Math.floor(nodeBounds.width / MESSAGE_FLOW_CHANNEL_WIDTH_DIVISOR)
      )
      : MESSAGE_FLOW_CHANNEL_SPACING;
    const firstDirection = is(first.sourceRef, 'bpmn:Participant') &&
      !is(first.targetRef, 'bpmn:Participant')
      ? 1
      : -1;

    forward.forEach((flow, index) => {
      offsets.set(flow, firstDirection * spacing * (index + 1));
    });
    reverse.forEach((flow, index) => {
      offsets.set(flow, -firstDirection * spacing * (index + 1));
    });
  }

  return offsets;
}

export function orderParticipantsByMessageFlow(collaboration, participantShapes, endpointShapes) {
  const participants = collaboration.participants || [];

  if (participants.length < 2) {
    return participants;
  }

  if (participants.length <= MAX_EXHAUSTIVE_PARTICIPANT_COUNT) {
    let bestOrder = participants;
    let bestScore = null;
    const permute = (prefix, remaining) => {
      if (!remaining.length) {
        const score = messageFlowOrderScore(
          prefix,
          collaboration,
          participantShapes,
          endpointShapes
        );

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
      const score = messageFlowOrderScore(
        candidate,
        collaboration,
        participantShapes,
        endpointShapes
      );

      if (!bestScore || compareScores(score, bestScore) < 0) {
        bestOrder = candidate;
        bestScore = score;
      }
    }

    ordered = bestOrder;
  }

  return ordered;
}

function messageFlowOrderScore(order, collaboration, participantShapes, endpointShapes) {
  const positions = new Map();
  const orderIndex = new Map(order.map((participant, index) => [ participant, index ]));
  const participantPairs = new Set();
  const prioritizeAdjacency = (collaboration.messageFlows || []).some(messageFlow => {
    const source = findEndpointParticipant(messageFlow.sourceRef, collaboration);
    const target = findEndpointParticipant(messageFlow.targetRef, collaboration);

    return source && target && !source.processRef && !target.processRef;
  });
  let y = 0;

  for (const participant of order) {
    positions.set(participant, y);
    y += participantShapes.get(participant).height + VERTICAL_GAP;
  }

  const geometryScore = (collaboration.messageFlows || []).reduce((total, messageFlow) => {
    const sourceParticipant = findEndpointParticipant(messageFlow.sourceRef, collaboration);
    const targetParticipant = findEndpointParticipant(messageFlow.targetRef, collaboration);

    if (!positions.has(sourceParticipant) || !positions.has(targetParticipant)) {
      return total;
    }

    const sourceCenter = getOrderedEndpointCenterY(
      messageFlow.sourceRef,
      sourceParticipant,
      positions,
      endpointShapes
    );
    const targetCenter = getOrderedEndpointCenterY(
      messageFlow.targetRef,
      targetParticipant,
      positions,
      endpointShapes
    );
    const downward = targetCenter > sourceCenter;
    const sourceY = getOrderedEndpointDockY(
      messageFlow.sourceRef,
      sourceParticipant,
      downward,
      true,
      positions,
      endpointShapes
    );
    const targetY = getOrderedEndpointDockY(
      messageFlow.targetRef,
      targetParticipant,
      downward,
      false,
      positions,
      endpointShapes
    );
    const bendPenalty = orderedMessageFlowNeedsBend(
      messageFlow,
      sourceParticipant,
      targetParticipant,
      sourceY,
      targetY,
      collaboration,
      positions,
      endpointShapes
    ) ? MESSAGE_FLOW_BEND_PENALTY : 0;

    return total + bendPenalty + Math.abs(targetY - sourceY);
  }, 0);
  let adjacencyPenalty = 0;

  if (prioritizeAdjacency) {
    for (const messageFlow of collaboration.messageFlows || []) {
      const source = findEndpointParticipant(messageFlow.sourceRef, collaboration);
      const target = findEndpointParticipant(messageFlow.targetRef, collaboration);

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

function getOrderedEndpointCenterY(endpoint, participant, positions, endpointShapes) {
  const endpointBounds = endpointShapes.get(endpoint);

  return positions.get(participant) + endpointBounds.y + endpointBounds.height / 2;
}

function getOrderedEndpointDockY(
    endpoint,
    participant,
    downward,
    source,
    positions,
    endpointShapes) {
  const endpointBounds = endpointShapes.get(endpoint);
  const top = positions.get(participant) + endpointBounds.y;
  const dockAtBottom = source ? downward : !downward;

  return dockAtBottom ? top + endpointBounds.height : top;
}

function orderedMessageFlowNeedsBend(
    messageFlow,
    sourceParticipant,
    targetParticipant,
    sourceY,
    targetY,
    collaboration,
    positions,
    endpointShapes) {
  const source = messageFlow.sourceRef;
  const target = messageFlow.targetRef;
  const sourceBounds = endpointShapes.get(source);
  const targetBounds = endpointShapes.get(target);
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

  return [ ...endpointShapes ].some(([ element, rect ]) => {
    if (element === source || element === target ||
        is(element, 'bpmn:Participant') ||
        is(element, 'bpmn:Lane') ||
        is(element, 'bpmn:SubProcess')) {
      return false;
    }

    const participant = findEndpointParticipant(element, collaboration);

    if (!positions.has(participant)) {
      return false;
    }

    const translated = bounds(
      rect.x,
      rect.y + positions.get(participant),
      rect.width,
      rect.height
    );

    return segmentEntersRect(start, end, inset(translated, MESSAGE_FLOW_OBSTACLE_INSET));
  });
}

function findEndpointParticipant(endpoint, collaboration) {
  if (is(endpoint, 'bpmn:Participant')) {
    return endpoint;
  }

  let parent = endpoint?.$parent;

  while (parent && !is(parent, 'bpmn:Process')) {
    parent = parent.$parent;
  }

  return (collaboration.participants || []).find(participant => participant.processRef === parent);
}
