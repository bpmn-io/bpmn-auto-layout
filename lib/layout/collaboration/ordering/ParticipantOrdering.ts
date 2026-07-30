import { is } from '../../../di/DiUtil.js';
import {
  VERTICAL_GAP,
  MESSAGE_FLOW_BEND_PENALTY,
  MAX_EXHAUSTIVE_PARTICIPANT_COUNT,
  MESSAGE_FLOW_OBSTACLE_INSET
} from '../../Constants.js';
import {
  point,
  bounds,
  segmentEntersRect,
  compareScores
} from '../../geometry/index.js';
import {
  findEndpointParticipantCached,
  resolveMessageFlowEndpoint
} from '../EndpointResolution.js';

import type { Rect } from 'diagram-js/lib/util/Types.js';
import type { ModdleElement } from 'moddle';
import type { BpmnParticipant } from '../../../moddle-types/bpmn.js';

import { isBpmnElement, isBpmnType } from '../../bpmn/Types.js';

import type {
  BpmnElement,
  BpmnElementFor
} from '../../bpmn/Types.js';

type Collaboration = BpmnElementFor<'bpmn:Collaboration'>;
type Participant = ModdleElement<BpmnParticipant>;
type ParticipantShapes = Map<BpmnElement, Rect>;
type EndpointShapes = Map<BpmnElement, Rect>;
type Score = number[];
type MessageFlow = {
  source: BpmnElement | undefined;
  target: BpmnElement | undefined;
  sourceBounds: Rect | undefined;
  targetBounds: Rect | undefined;
  sourceParticipant: Participant | undefined;
  targetParticipant: Participant | undefined;
};
type Obstacle = {
  element: BpmnElement;
  rect: Rect;
  participant: Participant | undefined;
  insetX: number;
  insetWidth: number;
  insetHeight: number;
};
type MessageFlowOrderContext = {
  messageFlows: MessageFlow[];
  obstacles: Obstacle[];
  useWeightedSeparation: boolean;
  prioritizeCollapsedAdjacency: boolean;
};
type MessageFlowOrderScorer = (order: Participant[]) => Score;
export function orderParticipantsByMessageFlow(
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    endpointShapes: EndpointShapes
): Participant[] {
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

  if (participantOrderingStrategy(participants.length) === 'exhaustive') {
    let bestOrder = participants;
    let bestScore: Score | null = null;
    const permute = (prefix: Participant[], remaining: Participant[]) => {
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

  let ordered: Participant[] = [ getRequired(participants[0]) ];

  for (const participant of participants.slice(1)) {
    let bestOrder: Participant[] = ordered;
    let bestScore: Score | null = null;

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

function participantOrderingStrategy(participantCount: number): 'exhaustive' | 'heuristic' {
  return participantCount <= MAX_EXHAUSTIVE_PARTICIPANT_COUNT
    ? 'exhaustive'
    : 'heuristic';
}

function createMessageFlowOrderScorer(
    participants: Participant[],
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    endpointShapes: EndpointShapes
): MessageFlowOrderScorer {
  const context = createMessageFlowOrderContext(collaboration, endpointShapes);

  if (participantOrderingStrategy(participants.length) === 'exhaustive') {
    return order => messageFlowOrderScore(order, participantShapes, context);
  }

  const participantIndexes = new Map<Participant, number>(
    participants.map((participant, index) => [ participant, index ])
  );
  const scores = new Map<string, Score>();

  return order => {
    const key = order.map(participant => participantIndexes.get(participant)).join(':');

    if (!scores.has(key)) {
      scores.set(key, messageFlowOrderScore(order, participantShapes, context));
    }

    return getRequired(scores.get(key));
  };
}

function createMessageFlowOrderContext(
    collaboration: Collaboration,
    endpointShapes: EndpointShapes
): MessageFlowOrderContext {
  const participantsByProcess = new Map<BpmnElement | undefined, Participant>();

  for (const participant of collaboration.participants || []) {
    if (!participantsByProcess.has(participant.processRef)) {
      participantsByProcess.set(participant.processRef, participant);
    }
  }

  const messageFlows = (collaboration.messageFlows || []).map(messageFlow => {
    const source = resolveEndpoint(messageFlow.sourceRef, endpointShapes);
    const target = resolveEndpoint(messageFlow.targetRef, endpointShapes);

    return {
      source,
      target,
      sourceBounds: source ? endpointShapes.get(source) : undefined,
      targetBounds: target ? endpointShapes.get(target) : undefined,
      sourceParticipant: findEndpointParticipant(source, participantsByProcess),
      targetParticipant: findEndpointParticipant(target, participantsByProcess)
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
      participant: findEndpointParticipant(element, participantsByProcess),
      insetX: rect.x + MESSAGE_FLOW_OBSTACLE_INSET,
      insetWidth: rect.width - 2 * MESSAGE_FLOW_OBSTACLE_INSET,
      insetHeight: rect.height - 2 * MESSAGE_FLOW_OBSTACLE_INSET
    }));

  return {
    messageFlows,
    obstacles,
    useWeightedSeparation: (collaboration.participants || [])
      .filter(participant => participant.processRef).length > 1,
    prioritizeCollapsedAdjacency: messageFlows.some(({
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

function messageFlowOrderScore(
    order: Participant[],
    participantShapes: ParticipantShapes,
    context: MessageFlowOrderContext
): Score {
  const positions = new Map<Participant, number>();
  const orderIndex = new Map<Participant, number>(
    order.map((participant, index) => [ participant, index ])
  );
  let y = 0;

  for (const participant of order) {
    positions.set(participant, y);
    y += getRequired(participantShapes.get(participant)).height + VERTICAL_GAP;
  }

  const geometryScore = context.messageFlows.reduce((total, messageFlow) => {
    const {
      source,
      target,
      sourceParticipant,
      targetParticipant
    } = messageFlow;

    if (!source || !target || !sourceParticipant || !targetParticipant ||
        !messageFlow.sourceBounds || !messageFlow.targetBounds ||
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
  let separationPenalty = 0;
  const participantPairs = new Set<string>();

  for (const {
    sourceParticipant: source,
    targetParticipant: target
  } of context.messageFlows) {

    if (!source || !target || !orderIndex.has(source) ||
        !orderIndex.has(target) || source === target) {
      continue;
    }

    const sourceIndex = getRequired(orderIndex.get(source));
    const targetIndex = getRequired(orderIndex.get(target));
    if (context.useWeightedSeparation) {
      const first = sourceIndex < targetIndex ? source : target;
      const last = sourceIndex < targetIndex ? target : source;

      if (Math.abs(sourceIndex - targetIndex) > 1) {
        separationPenalty += getRequired(positions.get(last)) -
          getRequired(positions.get(first)) -
          getRequired(participantShapes.get(first)).height -
          VERTICAL_GAP;
      }
    } else if (context.prioritizeCollapsedAdjacency) {
      const pair = sourceIndex < targetIndex
        ? `${ source.id }:${ target.id }`
        : `${ target.id }:${ source.id }`;

      if (!participantPairs.has(pair)) {
        participantPairs.add(pair);
        separationPenalty += Math.max(0, Math.abs(sourceIndex - targetIndex) - 1);
      }
    }
  }

  if (!context.useWeightedSeparation) {
    return context.prioritizeCollapsedAdjacency
      ? [ separationPenalty, geometryScore ]
      : [ geometryScore ];
  }

  return [
    geometryScore + separationPenalty,
    geometryScore,
    separationPenalty
  ];
}

function getOrderedEndpointCenterY(
    participant: Participant,
    positions: Map<Participant, number>,
    endpointBounds: Rect
): number {
  return getRequired(positions.get(participant)) +
    endpointBounds.y + endpointBounds.height / 2;
}

function getOrderedEndpointDockY(
    participant: Participant,
    downward: boolean,
    source: boolean,
    positions: Map<Participant, number>,
    endpointBounds: Rect
): number {
  const top = getRequired(positions.get(participant)) + endpointBounds.y;
  const dockAtBottom = source ? downward : !downward;

  return dockAtBottom ? top + endpointBounds.height : top;
}

function orderedMessageFlowNeedsBend(
    messageFlow: MessageFlow,
    sourceY: number,
    targetY: number,
    positions: Map<Participant, number>,
    obstacles: Obstacle[]
): boolean {
  const {
    source,
    target,
    sourceParticipant,
    targetParticipant,
    sourceBounds,
    targetBounds
  } = messageFlow;
  const resolvedSourceBounds = getRequired(sourceBounds);
  const resolvedTargetBounds = getRequired(targetBounds);
  const sourceIsParticipant = source === sourceParticipant;
  const targetIsParticipant = target === targetParticipant;
  const sourceX = resolvedSourceBounds.x + resolvedSourceBounds.width / 2;
  const targetX = resolvedTargetBounds.x + resolvedTargetBounds.width / 2;
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

  for (const {
    element,
    participant,
    insetX,
    insetWidth,
    insetHeight,
    rect
  } of obstacles) {
    if (element === source || element === target) {
      continue;
    }

    if (!participant || !positions.has(participant)) {
      continue;
    }

    const obstacle = bounds(
      insetX,
      rect.y + getRequired(positions.get(participant)) + MESSAGE_FLOW_OBSTACLE_INSET,
      insetWidth,
      insetHeight
    );
    const verticallyDisjoint = minY === maxY
      ? minY < obstacle.y || minY > obstacle.y + obstacle.height
      : maxY <= obstacle.y || minY >= obstacle.y + obstacle.height;

    if (start.x < obstacle.x ||
        start.x > obstacle.x + obstacle.width ||
        verticallyDisjoint) {
      continue;
    }

    if (segmentEntersRect(start, end, obstacle)) {
      return true;
    }
  }

  return false;
}


function resolveEndpoint(
    endpoint: BpmnElement | undefined,
    endpointShapes: EndpointShapes
): BpmnElement | undefined {
  const resolved = resolveMessageFlowEndpoint(endpoint, endpointShapes);

  return isBpmnElement(resolved) ? resolved : undefined;
}

function findEndpointParticipant(
    endpoint: BpmnElement | undefined,
    participantsByProcess: Map<BpmnElement | undefined, Participant>
): Participant | undefined {
  const participant = findEndpointParticipantCached(endpoint, participantsByProcess);

  return isBpmnType(participant, 'bpmn:Participant') ? participant : undefined;
}

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected participant ordering value');
  }

  return value;
}
