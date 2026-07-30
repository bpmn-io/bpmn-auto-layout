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
  createBpmnOrthogonalRouter
} from '../../routing/BpmnOrthogonalRouting.js';
import {
  findEndpointParticipant,
  resolveMessageFlowEndpoint
} from '../EndpointResolution.js';
import {
  collectCollaborationShapes,
  includeHorizontalRange
} from '../Helpers.js';

import type { Point } from 'diagram-js/lib/util/Types.js';
import type { ModdleElement } from 'moddle';
import type { BpmnElementFor } from '../../bpmn/Types.js';
import type { BpmnMessageFlow } from '../../../moddle-types/bpmn.js';
import type {
  BpmnElement,
  Bounds,
  CollaborationLayoutContext,
  Waypoint
} from '../../Types.js';

type Collaboration = BpmnElementFor<'bpmn:Collaboration'>;
type MessageFlow = ModdleElement<BpmnMessageFlow>;
type Participant = ReturnType<typeof findEndpointParticipant>;
type EndpointShapes = Map<BpmnElement, Bounds>;
type ParticipantShapes = Map<BpmnElement, Bounds>;
type MessageObstacle = {
  element: BpmnElement;
  rect: Bounds;
};
type RoutedConnection = {
  flow: BpmnElement;
  points: Waypoint[];
};
type MessageFlowRouterOptions = {
  obstacleInset?: number;
  allowPerpendicularCrossings?: boolean;
};
type MessageFlowRoutingContext = {
  source: BpmnElement;
  target: BpmnElement;
  sourceBounds: Bounds;
  targetBounds: Bounds;
  collaboration: Collaboration;
  participantShapes: ParticipantShapes;
  obstacles: MessageObstacle[];
  routedConnections: RoutedConnection[];
  channelOffset: number;
  downward: boolean;
  start: Point;
  end: Point;
  sourceParticipant: Participant;
  targetParticipant: Participant;
  sourceParticipantBounds: Bounds | undefined;
  targetParticipantBounds: Bounds | undefined;
  sourceIndex: number;
  targetIndex: number;
};
type ScopedMessageFlowRoutingContext = MessageFlowRoutingContext & {
  sourceParticipantBounds: Bounds;
  targetParticipantBounds: Bounds;
};
type PreparedMessageFlowRoutingContext =
  ScopedMessageFlowRoutingContext & {
    sourceIsParticipant: boolean;
    targetIsParticipant: boolean;
    sourcePoolEdgeY: number;
    targetPoolEdgeY: number;
    sourceObstacles: MessageObstacle[];
    targetObstacles: MessageObstacle[];
  };
type MessageFlowGroup = {
  messageFlow: MessageFlow;
  source: BpmnElement;
  target: BpmnElement;
};

export function routeMessageFlows(
    context: CollaborationLayoutContext
): CollaborationLayoutContext {
  const { layout } = context;
  const collaboration = context.collaboration;
  const { expandable } = context.participants;
  const { channelOffsets } = context.routing;

  if (!is(collaboration, 'bpmn:Collaboration')) {
    return context;
  }

  const shapes = collectCollaborationShapes(layout);
  const obstacles = getMessageObstacles(shapes);
  let participantBoundsChanged;

  do {
    const routes = routeAllMessageFlows(
      collaboration,
      layout.shapes,
      shapes,
      obstacles,
      channelOffsets
    );

    for (const [ messageFlow, points ] of routes) {
      layout.edges.set(messageFlow, points);
    }

    participantBoundsChanged = includeResizableParticipantMessageDocks(
      collaboration,
      layout.shapes,
      layout.edges,
      expandable
    );
  } while (participantBoundsChanged);

  return context;
}

export function routeMessageFlow(
    source: BpmnElement,
    target: BpmnElement,
    sourceBounds: Bounds,
    targetBounds: Bounds,
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    obstacles: MessageObstacle[],
    routedConnections: RoutedConnection[],
    channelOffset: number
): Waypoint[] {
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

  if (!hasParticipantScope(routing)) {
    return routeUnscopedMessageFlow(routing);
  }

  const preparedRouting = prepareMessageFlowDocks(routing);

  const verticalRoute = tryVerticalMessageFlowRoute(preparedRouting);

  if (verticalRoute) {
    return verticalRoute;
  }

  return Math.abs(preparedRouting.sourceIndex - preparedRouting.targetIndex) === 1
    ? routeAdjacentParticipantRows(preparedRouting)
    : routeSeparatedParticipantRows(preparedRouting);
}

function sameVerticalCenter(sourceBounds: Bounds, targetBounds: Bounds): boolean {
  return sourceBounds.y + sourceBounds.height / 2 ===
    targetBounds.y + targetBounds.height / 2;
}

function createMessageFlowRoutingContext(
    source: BpmnElement,
    target: BpmnElement,
    sourceBounds: Bounds,
    targetBounds: Bounds,
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    obstacles: MessageObstacle[],
    routedConnections: RoutedConnection[],
    channelOffset: number
): MessageFlowRoutingContext {
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
      .map(participant => getRequired(participantShapes.get(participant)).y)
      .sort((a, b) => a - b)
  ) ];
  const sourceIndex = sourceParticipantBounds
    ? participantRows.indexOf(sourceParticipantBounds.y)
    : -1;
  const targetIndex = targetParticipantBounds
    ? participantRows.indexOf(targetParticipantBounds.y)
    : -1;

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

function hasParticipantScope(
    routing: MessageFlowRoutingContext
): routing is ScopedMessageFlowRoutingContext {
  return !!routing.sourceParticipantBounds &&
    !!routing.targetParticipantBounds &&
    routing.sourceIndex !== -1 &&
    routing.targetIndex !== -1;
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
}: MessageFlowRoutingContext): Waypoint[] {
  return createMessageFlowRouter(
    obstacles,
    source,
    target,
    routedConnections,
    {
      obstacleInset: MESSAGE_FLOW_OBSTACLE_INSET,
      allowPerpendicularCrossings: true
    }
  ).findRoute(start, end) || directConnection(sourceBounds, targetBounds);
}

function prepareMessageFlowDocks(
    routing: ScopedMessageFlowRoutingContext
): PreparedMessageFlowRoutingContext {
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

  return Object.assign(routing, {
    sourceIsParticipant,
    targetIsParticipant,
    sourcePoolEdgeY: downward
      ? sourceParticipantBounds.y + sourceParticipantBounds.height
      : sourceParticipantBounds.y,
    targetPoolEdgeY: downward
      ? targetParticipantBounds.y
      : targetParticipantBounds.y + targetParticipantBounds.height,
    sourceObstacles: obstacles.filter(({ rect }) => {
      return centerIsInside(rect, sourceParticipantBounds);
    }),
    targetObstacles: obstacles.filter(({ rect }) => {
      return centerIsInside(rect, targetParticipantBounds);
    })
  });
}

function tryVerticalMessageFlowRoute(
    routing: PreparedMessageFlowRoutingContext
): Waypoint[] | null {
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
  const clearRouter = createMessageFlowRouter(obstacles, source, target);

  if ((sourceIsParticipant || targetIsParticipant) && start.x === end.x) {
    if (clearRouter.isClear([ start, end ])) {
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

    const localBypass = clearRouter.findRoute(start, end);

    if (localBypass) {
      return localBypass;
    }
  } else if (
    start.x === end.x &&
    clearRouter.isClear([ start, end ])
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
}: PreparedMessageFlowRoutingContext): Waypoint[] {
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

function routeSeparatedParticipantRows(
    routing: PreparedMessageFlowRoutingContext
): Waypoint[] {
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

export function getMessageObstacles(
    shapes: EndpointShapes
): MessageObstacle[] {
  return [ ...shapes ]
    .filter(([ element ]) => {
      return !is(element, 'bpmn:Lane') &&
          !is(element, 'bpmn:Participant') &&
          !is(element, 'bpmn:SubProcess') &&
          !isArtifact(element);
    })
    .map(([ element, rect ]) => ({ element, rect }));
}

export function routeAllMessageFlows(
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    endpointShapes: EndpointShapes,
    obstacles: MessageObstacle[],
    channelOffsets: Map<BpmnElement, number>
): Map<MessageFlow, Waypoint[]> {
  const routes = new Map<MessageFlow, Waypoint[]>();
  const routedConnections: RoutedConnection[] = [];

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

function includeResizableParticipantMessageDocks(
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    edges: Map<BpmnElement, Waypoint[]>,
    expandableParticipants: Set<BpmnElement>
): boolean {
  let changed = false;

  for (const messageFlow of collaboration.messageFlows || []) {
    const points = edges.get(messageFlow);

    if (!points?.length) {
      continue;
    }

    const endpointDocks: Array<[ BpmnElement | undefined, Point ]> = [
      [ messageFlow.sourceRef, points[0] ],
      [ messageFlow.targetRef, points[points.length - 1] ]
    ];

    for (const [ endpoint, dock ] of endpointDocks) {
      if (
        !is(endpoint, 'bpmn:Participant') ||
        !expandableParticipants.has(endpoint)
      ) {
        continue;
      }

      const participantBounds = getRequired(participantShapes.get(endpoint));
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

function findMessageFlowDockX(
    endpointBounds: Bounds,
    downward: boolean,
    source: boolean,
    offset: number,
    obstacles: MessageObstacle[],
    sourceElement: BpmnElement,
    targetElement: BpmnElement,
    routedConnections: RoutedConnection[]
): number {
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
  const router = createMessageFlowRouter(
    obstacles,
    sourceElement,
    targetElement,
    routedConnections,
    {
      obstacleInset: MESSAGE_FLOW_OBSTACLE_INSET,
      allowPerpendicularCrossings: true
    }
  );

  return candidates.find(candidate => {
    return router.isClear([
      point(candidate, dockY),
      point(candidate, outsideY)
    ]);
  }) || preferredX;
}

function findMessageFlowVerticalBypass(
    source: BpmnElement,
    target: BpmnElement,
    sourceBounds: Bounds,
    targetBounds: Bounds,
    sourceIsParticipant: boolean,
    targetIsParticipant: boolean,
    start: Point,
    end: Point,
    obstacles: MessageObstacle[],
    channelOffset: number
): Waypoint[] | null {
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
  const router = createMessageFlowRouter(obstacles, source, target);

  for (const { channelX } of sides) {
    const dockX = nodeBounds.x + nodeBounds.width / 2 + channelOffset;
    const dock = point(dockX, dockY);
    const lead = point(dockX, leadY);
    const channel = point(channelX, leadY);
    const participantDock = point(channelX, sourceIsParticipant ? start.y : end.y);
    const candidate = sourceIsParticipant
      ? [ participantDock, channel, lead, dock ]
      : [ dock, lead, channel, participantDock ];

    if (router.isClear(candidate)) {
      return candidate;
    }
  }

  return null;
}

function centerIsInside(rect: Bounds, container: Bounds): boolean {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;

  return x >= container.x &&
    x <= container.x + container.width &&
    y >= container.y &&
    y <= container.y + container.height;
}

function routeMessageLeg(
    start: Point,
    end: Point,
    obstacles: MessageObstacle[],
    source: BpmnElement,
    target: BpmnElement,
    routedConnections: RoutedConnection[]
): Waypoint[] {
  const router = createMessageFlowRouter(
    obstacles,
    source,
    target,
    routedConnections,
    {
      obstacleInset: MESSAGE_FLOW_OBSTACLE_INSET,
      allowPerpendicularCrossings: true
    }
  );

  if (router.isClear([ start, end ])) {
    return [ start, end ];
  }

  return router.findRoute(start, end) ||
    createMessageFlowRouter(
      obstacles,
      source,
      target,
      [],
      {
        obstacleInset: MESSAGE_FLOW_OBSTACLE_INSET,
        allowPerpendicularCrossings: true
      }
    ).findRoute(start, end) ||
    [ start, end ];
}

function createMessageFlowRouter(
    obstacles: MessageObstacle[],
    sourceElement: BpmnElement,
    targetElement: BpmnElement,
    routedConnections: RoutedConnection[] = [],
    options: MessageFlowRouterOptions = {}
) {
  return createBpmnOrthogonalRouter({
    shapes: obstacles,
    sourceElement,
    targetElement,
    routedConnections,
    ...options
  });
}

function constrainParticipantDockX(x: number, participantBounds: Bounds): number {
  return Math.max(
    participantBounds.x + PARTICIPANT_HEADER_WIDTH,
    Math.min(
      x,
      participantBounds.x + participantBounds.width - PARTICIPANT_HEADER_WIDTH
    )
  );
}

export function assignMessageFlowChannelOffsets(
    collaboration: Collaboration,
    shapes: EndpointShapes
): Map<MessageFlow, number> {
  const groups = new Map<string, MessageFlowGroup[]>();
  const offsets = new Map<MessageFlow, number>();

  for (const messageFlow of collaboration.messageFlows || []) {
    const source = resolveMessageFlowEndpoint(messageFlow.sourceRef, shapes);
    const target = resolveMessageFlowEndpoint(messageFlow.targetRef, shapes);
    const sourceId = source.id;
    const targetId = target.id;
    const key = [ sourceId, targetId ].sort().join(':');

    const flows = groups.get(key);

    if (flows) {
      flows.push({ messageFlow, source, target });
    } else {
      groups.set(key, [ { messageFlow, source, target } ]);
    }
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

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected message flow routing value');
  }

  return value;
}
