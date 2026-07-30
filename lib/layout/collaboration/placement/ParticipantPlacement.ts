import { is } from '../../../di/DiUtil.js';
import {
  ROUTING_MARGIN,
  PARTICIPANT_HEADER_WIDTH,
  MESSAGE_FLOW_BEND_PENALTY,
  MESSAGE_FLOW_SIDE_OFFSET,
  MAX_EXHAUSTIVE_PARTICIPANT_COUNT
} from '../../Constants.js';
import {
  point,
  bounds,
  compareScores,
  routeLength,
  toSegments,
  segmentsProperlyCross
} from '../../geometry/index.js';
import {
  getMessageObstacles,
  routeAllMessageFlows
} from '../routing/MessageFlowRouting.js';
import {
  findEndpointParticipant,
  resolveMessageFlowEndpoint
} from '../EndpointResolution.js';
import {
  includeHorizontalRange
} from '../Helpers.js';

import type { ModdleElement } from 'moddle';

import type {
  BpmnElement,
  Bounds,
  Waypoint
} from '../../Types.js';
import type { BpmnElementFor } from '../../bpmn/Types.js';
import type { BpmnParticipant } from '../../../moddle-types/bpmn.js';

type Collaboration = BpmnElementFor<'bpmn:Collaboration'>;
type Participant = ModdleElement<BpmnParticipant>;
type ParticipantShapes = Map<BpmnElement, Bounds>;
type EndpointShapes = Map<BpmnElement, Bounds>;
type ConnectionRoutes = Array<[ BpmnElement, Waypoint[] ]>;
type Positions = Map<BpmnElement, number>;
type ParticipantConnections = Array<[ Participant, Participant ]>;
type Score = number[];

export function alignParticipantsHorizontally(
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    endpointShapes: EndpointShapes,
    connectionRoutes: ConnectionRoutes,
    channelOffsets: Map<BpmnElement, number>,
    anchorPositionedParticipants: Set<BpmnElement>,
    expandableParticipants: Set<BpmnElement>
) {
  const alignment = createParticipantAlignmentProblem(
    collaboration,
    participantShapes,
    endpointShapes,
    connectionRoutes,
    channelOffsets,
    anchorPositionedParticipants,
    expandableParticipants
  );

  if (!alignment.endpointRecords.length) {
    return alignment.positions;
  }

  return optimizeParticipantPositions(
    alignment,
    createHorizontalAlignmentScorer(alignment)
  );
}

function createParticipantAlignmentProblem(
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    endpointShapes: EndpointShapes,
    connectionRoutes: ConnectionRoutes,
    channelOffsets: Map<BpmnElement, number>,
    anchorPositionedParticipants: Set<BpmnElement>,
    expandableParticipants: Set<BpmnElement>
) {
  const participants = collaboration.participants || [];
  const processParticipants = participants.filter(participant => {
    return participant.processRef;
  });
  const anchorParticipant = selectAnchorParticipant(
    processParticipants,
    participantShapes
  );
  const movableParticipants = processParticipants.filter(participant => {
    return participant !== anchorParticipant;
  });
  const initialPositions = new Map(participants.map(participant => {
    return [ participant, getRequired(participantShapes.get(participant)).x ];
  }));
  const positions = new Map(initialPositions);
  const endpointRecords = collectAlignmentEndpointRecords(
    collaboration,
    endpointShapes,
    movableParticipants
  );
  const localIntervals = collectEndpointLocalIntervals(
    endpointRecords,
    endpointShapes,
    participantShapes
  );

  return {
    collaboration,
    participantShapes,
    endpointShapes,
    connectionRoutes,
    channelOffsets,
    anchorPositionedParticipants,
    expandableParticipants,
    participants,
    movableParticipants,
    initialPositions,
    positions,
    endpointRecords,
    localIntervals
  };
}

function selectAnchorParticipant(
    processParticipants: Participant[],
    participantShapes: ParticipantShapes
): Participant | null {
  return processParticipants.reduce<Participant | null>((largest, participant) => {
    if (!largest) {
      return participant;
    }

    const rect = getRequired(participantShapes.get(participant));
    const largestRect = getRequired(participantShapes.get(largest));

    return rect.width * rect.height > largestRect.width * largestRect.height
      ? participant
      : largest;
  }, null);
}

function collectAlignmentEndpointRecords(
    collaboration: Collaboration,
    endpointShapes: EndpointShapes,
    movableParticipants: Participant[]
) {
  return (collaboration.messageFlows || []).map(messageFlow => {
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
        record.sourceParticipant &&
        record.targetParticipant &&
        record.sourceParticipant !== record.targetParticipant &&
        (
          movableParticipants.includes(record.sourceParticipant) ||
          movableParticipants.includes(record.targetParticipant)
        );
  });
}

function collectEndpointLocalIntervals(
    endpointRecords: ReturnType<typeof collectAlignmentEndpointRecords>,
    endpointShapes: EndpointShapes,
    participantShapes: ParticipantShapes
) {
  const localIntervals = new Map();

  for (const { source, target, sourceParticipant, targetParticipant } of endpointRecords) {
    localIntervals.set(
      source,
      getLocalHorizontalInterval(
        source,
        sourceParticipant,
        endpointShapes,
        participantShapes
      )
    );
    localIntervals.set(
      target,
      getLocalHorizontalInterval(
        target,
        targetParticipant,
        endpointShapes,
        participantShapes
      )
    );
  }

  return localIntervals;
}

function createHorizontalAlignmentScorer(
    alignment: ReturnType<typeof createParticipantAlignmentProblem>
) {
  const {
    anchorPositionedParticipants,
    channelOffsets,
    collaboration,
    connectionRoutes,
    endpointShapes,
    expandableParticipants,
    initialPositions,
    participantShapes,
    participants
  } = alignment;
  const scoreCache = new Map<string, Score>();

  return (candidatePositions: Positions): Score => {
    const key = participants
      .map(participant => candidatePositions.get(participant))
      .join(':');

    if (!scoreCache.has(key)) {
      scoreCache.set(key, horizontalAlignmentScore(
        candidatePositions,
        initialPositions,
        collaboration,
        participantShapes,
        endpointShapes,
        connectionRoutes,
        channelOffsets,
        anchorPositionedParticipants,
        expandableParticipants
      ));
    }

    return getRequired(scoreCache.get(key));
  };
}

function optimizeParticipantPositions(
    alignment: ReturnType<typeof createParticipantAlignmentProblem>,
    scorePositions: ReturnType<typeof createHorizontalAlignmentScorer>
): Positions {
  const {
    endpointRecords,
    localIntervals,
    movableParticipants,
    positions
  } = alignment;
  let currentScore = scorePositions(positions);
  let changed;

  do {
    changed = false;

    for (const participant of movableParticipants) {
      const candidates: number[] = [ getRequired(positions.get(participant)) ];

      for (const record of endpointRecords) {
        if (record.sourceParticipant === participant) {
          for (const sourceOffset of localIntervals.get(record.source)) {
            for (const targetOffset of localIntervals.get(record.target)) {
              candidates.push(Math.round(
                getRequired(positions.get(record.targetParticipant)) +
                targetOffset -
                sourceOffset
              ));
            }
          }
        } else if (record.targetParticipant === participant) {
          for (const sourceOffset of localIntervals.get(record.source)) {
            for (const targetOffset of localIntervals.get(record.target)) {
              candidates.push(Math.round(
                getRequired(positions.get(record.sourceParticipant)) +
                sourceOffset -
                targetOffset
              ));
            }
          }
        }
      }

      let bestPosition = getRequired(positions.get(participant));
      let bestScore = currentScore;

      for (const candidate of [ ...new Set(candidates) ]) {
        if (candidate === positions.get(participant)) {
          continue;
        }

        const candidatePositions = new Map(positions);

        candidatePositions.set(participant, candidate);

        const candidateScore = scorePositions(candidatePositions);

        if (compareScores(candidateScore, bestScore) < 0) {
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

export function alignParticipantComponentsLeft(
    collaboration: Collaboration,
    participantShapes: ParticipantShapes
): Positions {
  const participants = collaboration.participants || [];

  if (participants.length < 2) {
    return new Map();
  }

  const neighbors = new Map<Participant, Set<Participant>>(participants.map(participant => {
    return [ participant, new Set() ];
  }));

  for (const messageFlow of collaboration.messageFlows || []) {
    const source = findEndpointParticipant(messageFlow.sourceRef, collaboration);
    const target = findEndpointParticipant(messageFlow.targetRef, collaboration);

    if (!neighbors.has(source) || !neighbors.has(target) || source === target) {
      continue;
    }

    getRequired(neighbors.get(source)).add(target);
    getRequired(neighbors.get(target)).add(source);
  }

  const targetX = Math.min(...participants.map(participant => {
    return getRequired(participantShapes.get(participant)).x;
  }));
  const offsets = new Map<BpmnElement, number>();
  const visited = new Set<Participant>();

  for (const participant of participants) {
    if (visited.has(participant)) {
      continue;
    }

    const component: Participant[] = [];
    const queue: Participant[] = [ participant ];

    visited.add(participant);

    while (queue.length) {
      const current = getRequired(queue.shift());

      component.push(current);

      for (const neighbor of getRequired(neighbors.get(current))) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const componentX = Math.min(...component.map(member => {
      return getRequired(participantShapes.get(member)).x;
    }));
    const dx = targetX - componentX;

    for (const member of component) {
      offsets.set(member, dx);
    }
  }

  return offsets;
}

function getLocalHorizontalInterval(
    element: BpmnElement,
    participant: Participant,
    endpointShapes: EndpointShapes,
    participantShapes: ParticipantShapes
): number[] {
  const rect = getRequired(endpointShapes.get(element));
  const participantBounds = getRequired(participantShapes.get(participant));

  if (is(element, 'bpmn:Participant')) {
    const inset = ROUTING_MARGIN + MESSAGE_FLOW_SIDE_OFFSET;

    return [ inset, participantBounds.width - inset ];
  }

  return [ rect.x + rect.width / 2 - participantBounds.x ];
}

function horizontalAlignmentScore(
    positions: Positions,
    initialPositions: Positions,
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    endpointShapes: EndpointShapes,
    connectionRoutes: ConnectionRoutes,
    channelOffsets: Map<BpmnElement, number>,
    anchorPositionedParticipants: Set<BpmnElement>,
    expandableParticipants: Set<BpmnElement>
) {
  const translatedShapes = new Map([ ...endpointShapes ].map(([ element, rect ]) => {
    const participant = findEndpointParticipant(element, collaboration);
    const dx = positions.has(participant)
      ? getRequired(positions.get(participant)) -
        getRequired(initialPositions.get(participant))
      : 0;

    return [
      element,
      bounds(rect.x + dx, rect.y, rect.width, rect.height)
    ];
  }));
  const translatedParticipants = new Map((collaboration.participants || []).map(participant => {
    return [ participant, getRequired(translatedShapes.get(participant)) ];
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
  const routes = routeAllMessageFlows(
    collaboration,
    translatedParticipants,
    translatedShapes,
    obstacles,
    channelOffsets
  );
  const bendCount = [ ...routes.values() ].filter(points => points.length > 2).length;

  const routeCosts = [ ...routes.values() ].map(points => {
    const bendCost = points.length > 2 ? MESSAGE_FLOW_BEND_PENALTY : 0;

    return routeLength(points) + bendCost;
  });
  const routingCost = routeCosts.reduce((total, cost) => total + cost, 0);
  const translatedConnections = connectionRoutes.map(([ element, points ]) => {
    const participant = findEndpointParticipant(element, collaboration);
    const dx = positions.has(participant)
      ? getRequired(positions.get(participant)) -
        getRequired(initialPositions.get(participant))
      : 0;

    return points.map(routePoint => point(routePoint.x + dx, routePoint.y));
  });
  const crossingCount = countRouteCrossings([
    ...translatedConnections,
    ...routes.values()
  ]);
  const displacement = [ ...positions ].reduce((total, [ participant, x ]) => {
    return total + Math.abs(x - getRequired(initialPositions.get(participant)));
  }, 0);

  const routeQuality = (collaboration.participants || []).length >
    MAX_EXHAUSTIVE_PARTICIPANT_COUNT
    ? [ bendCount, crossingCount ]
    : [ crossingCount, bendCount ];

  return [
    ...routeQuality,
    Math.max(0, ...routeCosts),
    routingCost,
    displacement
  ];
}

function countRouteCrossings(routes: Waypoint[][]): number {
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

export function sizeAndPositionParticipantsFromMessageAnchors(
    collaboration: Collaboration,
    participantShapes: ParticipantShapes,
    endpointShapes: EndpointShapes,
    channelOffsets: Map<BpmnElement, number>,
    anchorPositionedParticipants: Set<BpmnElement>,
    expandableParticipants: Set<BpmnElement>
): void {
  const participants = collaboration.participants || [];
  const anchorPositioned = participants.filter(participant => {
    return anchorPositionedParticipants.has(participant);
  });
  const {
    anchors,
    participantConnections
  } = collectParticipantAnchorConstraints(
    collaboration,
    endpointShapes,
    channelOffsets,
    anchorPositioned
  );
  const positioned = positionParticipantsFromAnchors(
    participants,
    anchorPositioned,
    anchors,
    participantShapes,
    anchorPositionedParticipants,
    expandableParticipants
  );

  positionConnectedParticipants(
    anchorPositioned,
    participantConnections,
    positioned,
    participantShapes
  );
  ensureParticipantConnectionOverlap(
    participantConnections,
    participantShapes,
    expandableParticipants
  );
}

function collectParticipantAnchorConstraints(
    collaboration: Collaboration,
    endpointShapes: EndpointShapes,
    channelOffsets: Map<BpmnElement, number>,
    anchorPositioned: Participant[]
) {
  const anchors = new Map<Participant, number[]>(
    anchorPositioned.map(participant => [ participant, [] ])
  );
  const participantConnections: ParticipantConnections = [];

  for (const messageFlow of collaboration.messageFlows || []) {
    const source = resolveMessageFlowEndpoint(messageFlow.sourceRef, endpointShapes);
    const target = resolveMessageFlowEndpoint(messageFlow.targetRef, endpointShapes);
    const offset = channelOffsets.get(messageFlow) || 0;

    if (anchors.has(source) && !is(target, 'bpmn:Participant')) {
      const targetBounds = endpointShapes.get(target);

      getRequired(anchors.get(source)).push(
        getRequired(targetBounds).x + getRequired(targetBounds).width / 2 + offset
      );
    }
    if (anchors.has(target) && !is(source, 'bpmn:Participant')) {
      const sourceBounds = endpointShapes.get(source);

      getRequired(anchors.get(target)).push(
        getRequired(sourceBounds).x + getRequired(sourceBounds).width / 2 + offset
      );
    }
    if (
      is(source, 'bpmn:Participant') &&
      is(target, 'bpmn:Participant') &&
      (anchors.has(source) || anchors.has(target))
    ) {
      participantConnections.push([ source, target ]);
    }
  }

  return { anchors, participantConnections };
}

function positionParticipantsFromAnchors(
    participants: Participant[],
    anchorPositioned: Participant[],
    anchors: Map<Participant, number[]>,
    participantShapes: ParticipantShapes,
    anchorPositionedParticipants: Set<BpmnElement>,
    expandableParticipants: Set<BpmnElement>
): Set<Participant> {
  const positioned = new Set(participants.filter(participant => {
    return !anchorPositionedParticipants.has(participant);
  }));

  for (const participant of anchorPositioned) {
    const participantAnchors = getRequired(anchors.get(participant));

    if (!participantAnchors.length) {
      continue;
    }

    const participantBounds = getRequired(participantShapes.get(participant));
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

  return positioned;
}

function positionConnectedParticipants(
    anchorPositioned: Participant[],
    participantConnections: ParticipantConnections,
    positioned: Set<Participant>,
    participantShapes: ParticipantShapes
): void {
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
        const neighborBounds = getRequired(participantShapes.get(neighbor));

        return sum + neighborBounds.x + neighborBounds.width / 2;
      }, 0) / neighbors.length;
      const participantBounds = getRequired(participantShapes.get(participant));

      participantBounds.x = Math.round(center - participantBounds.width / 2);
      positioned.add(participant);
      changed = true;
    }
  }
}

function ensureParticipantConnectionOverlap(
    participantConnections: ParticipantConnections,
    participantShapes: ParticipantShapes,
    expandableParticipants: Set<BpmnElement>
): void {
  for (const [ source, target ] of participantConnections) {
    ensureParticipantDockOverlap(
      getRequired(participantShapes.get(source)),
      getRequired(participantShapes.get(target)),
      expandableParticipants.has(source),
      expandableParticipants.has(target)
    );
  }
}

function ensureParticipantDockOverlap(
    source: Bounds,
    target: Bounds,
    sourceResizable = true,
    targetResizable = true
): void {
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


function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected participant placement value');
  }

  return value;
}
