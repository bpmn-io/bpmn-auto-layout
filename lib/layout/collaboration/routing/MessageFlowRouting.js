import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import {
  ROUTING_MARGIN,
  PARTICIPANT_HEADER_WIDTH,
  MESSAGE_FLOW_SIDE_OFFSET,
  MESSAGE_FLOW_CHANNEL_SPACING,
  MESSAGE_FLOW_CHANNEL_WIDTH_DIVISOR,
  MAX_EXHAUSTIVE_PARTICIPANT_COUNT,
  MESSAGE_FLOW_OBSTACLE_INSET
} from '../../Constants.js';
import {
  point,
  directConnection,
  cleanPoints
} from '../../geometry/index.js';
import {
  visibilityRoute,
  segmentIsClear,
  pathIsClear
} from '../../process/routing/SequenceFlowRouting.js';
import {
  findEndpointParticipant,
  resolveMessageFlowEndpoint
} from '../EndpointResolution.js';

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
  if (sameVerticalCenter(sourceBounds, targetBounds)) {
    return directConnection(sourceBounds, targetBounds);
  }

  const routing = createMessageFlowRoutingContext(
    source,
    target,
    sourceBounds,
    targetBounds,
    collaboration,
    participantShapes,
    obstacles,
    routedConnections,
    channelOffset
  );

  if (!routing.sourceParticipantBounds ||
      !routing.targetParticipantBounds ||
      routing.sourceIndex === -1 ||
      routing.targetIndex === -1) {
    return routeUnscopedMessageFlow(routing);
  }

  prepareMessageFlowDocks(routing);

  const verticalRoute = tryVerticalMessageFlowRoute(routing);

  if (verticalRoute) {
    return verticalRoute;
  }

  return Math.abs(routing.sourceIndex - routing.targetIndex) === 1
    ? routeAdjacentParticipantRows(routing)
    : routeSeparatedParticipantRows(routing);
}

function sameVerticalCenter(sourceBounds, targetBounds) {
  return sourceBounds.y + sourceBounds.height / 2 ===
    targetBounds.y + targetBounds.height / 2;
}

function createMessageFlowRoutingContext(
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

  return {
    source,
    target,
    sourceBounds,
    targetBounds,
    collaboration,
    participantShapes,
    obstacles,
    routedConnections,
    channelOffset,
    downward,
    start,
    end,
    sourceParticipant,
    targetParticipant,
    sourceParticipantBounds,
    targetParticipantBounds,
    sourceIndex,
    targetIndex
  };
}

function routeUnscopedMessageFlow({
  end,
  obstacles,
  routedConnections,
  source,
  sourceBounds,
  start,
  target,
  targetBounds
}) {
  return visibilityRoute(
    start,
    end,
    obstacles,
    source,
    target,
    routedConnections,
    MESSAGE_FLOW_OBSTACLE_INSET,
    true
  ) || directConnection(sourceBounds, targetBounds);
}

function prepareMessageFlowDocks(routing) {
  const {
    channelOffset,
    downward,
    end,
    obstacles,
    routedConnections,
    source,
    sourceBounds,
    sourceParticipant,
    sourceParticipantBounds,
    start,
    target,
    targetBounds,
    targetParticipant,
    targetParticipantBounds
  } = routing;
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

  routing.sourceIsParticipant = sourceIsParticipant;
  routing.targetIsParticipant = targetIsParticipant;
  routing.sourcePoolEdgeY = downward
    ? sourceParticipantBounds.y + sourceParticipantBounds.height
    : sourceParticipantBounds.y;
  routing.targetPoolEdgeY = downward
    ? targetParticipantBounds.y
    : targetParticipantBounds.y + targetParticipantBounds.height;
  routing.sourceObstacles = obstacles.filter(({ rect }) => {
    return centerIsInside(rect, sourceParticipantBounds);
  });
  routing.targetObstacles = obstacles.filter(({ rect }) => {
    return centerIsInside(rect, targetParticipantBounds);
  });
}

function tryVerticalMessageFlowRoute(routing) {
  const {
    channelOffset,
    end,
    obstacles,
    source,
    sourceBounds,
    sourceIsParticipant,
    start,
    target,
    targetBounds,
    targetIsParticipant
  } = routing;

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
  } else if (
    start.x === end.x &&
    segmentIsClear(start, end, obstacles, source, target, [])
  ) {
    return [ start, end ];
  }

  return null;
}

function routeAdjacentParticipantRows({
  end,
  routedConnections,
  source,
  sourceObstacles,
  sourcePoolEdgeY,
  start,
  target,
  targetObstacles,
  targetPoolEdgeY
}) {
  const channelY = Math.round((sourcePoolEdgeY + targetPoolEdgeY) / 2);
  const sourceChannel = point(start.x, channelY);
  const targetChannel = point(end.x, channelY);

  return cleanPoints([
    ...routeMessageLeg(
      start,
      sourceChannel,
      sourceObstacles,
      source,
      target,
      routedConnections
    ),
    targetChannel,
    ...routeMessageLeg(
      targetChannel,
      end,
      targetObstacles,
      source,
      target,
      routedConnections
    ).slice(1)
  ]);
}

function routeSeparatedParticipantRows(routing) {
  const {
    collaboration,
    downward,
    end,
    participantShapes,
    routedConnections,
    source,
    sourceObstacles,
    sourceParticipantBounds,
    sourcePoolEdgeY,
    start,
    target,
    targetObstacles,
    targetParticipantBounds,
    targetPoolEdgeY
  } = routing;
  const direction = downward ? 1 : -1;
  const sourceChannelY = sourcePoolEdgeY + direction * ROUTING_MARGIN;
  const targetChannelY = targetPoolEdgeY - direction * ROUTING_MARGIN;
  const sourceChannel = point(start.x, sourceChannelY);
  const targetChannel = point(end.x, targetChannelY);
  const participantBounds = [ ...participantShapes.values() ];
  const largeCollaboration = (collaboration.participants || []).length >
    MAX_EXHAUSTIVE_PARTICIPANT_COUNT;
  const firstRowY = Math.min(sourceParticipantBounds.y, targetParticipantBounds.y);
  const lastRowY = Math.max(sourceParticipantBounds.y, targetParticipantBounds.y);
  const interveningParticipants = participantBounds.filter(rect => {
    return rect.y > firstRowY && rect.y < lastRowY;
  });
  const rightExteriorX = Math.max(
    ...participantBounds.map(rect => rect.x + rect.width)
  ) + ROUTING_MARGIN;
  const channelXs = largeCollaboration
    ? [
      start.x,
      end.x,
      ...interveningParticipants.flatMap(rect => [
        rect.x - ROUTING_MARGIN,
        rect.x + rect.width + ROUTING_MARGIN
      ]),
      Math.min(...participantBounds.map(rect => rect.x)) - ROUTING_MARGIN,
      rightExteriorX
    ]
    : [ rightExteriorX ];
  const channelX = [ ...new Set(channelXs) ].filter(candidateX => {
    return interveningParticipants.every(rect => {
      return candidateX <= rect.x - ROUTING_MARGIN ||
        candidateX >= rect.x + rect.width + ROUTING_MARGIN;
    });
  }).sort((a, b) => {
    const aDistance = Math.abs(start.x - a) + Math.abs(end.x - a);
    const bDistance = Math.abs(start.x - b) + Math.abs(end.x - b);

    return aDistance - bDistance;
  })[0];

  return cleanPoints([
    ...routeMessageLeg(
      start,
      sourceChannel,
      sourceObstacles,
      source,
      target,
      routedConnections
    ),
    point(channelX, sourceChannelY),
    point(channelX, targetChannelY),
    targetChannel,
    ...routeMessageLeg(
      targetChannel,
      end,
      targetObstacles,
      source,
      target,
      routedConnections
    ).slice(1)
  ]);
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
      routedConnections,
      MESSAGE_FLOW_OBSTACLE_INSET,
      true
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
  if (segmentIsClear(
    start,
    end,
    obstacles,
    source,
    target,
    routedConnections,
    MESSAGE_FLOW_OBSTACLE_INSET,
    true
  )) {
    return [ start, end ];
  }

  return visibilityRoute(
    start,
    end,
    obstacles,
    source,
    target,
    routedConnections,
    MESSAGE_FLOW_OBSTACLE_INSET,
    true
  ) ||
    visibilityRoute(
      start,
      end,
      obstacles,
      source,
      target,
      [],
      MESSAGE_FLOW_OBSTACLE_INSET,
      true
    ) ||
    [ start, end ];
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
