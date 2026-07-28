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
  routeMessageFlows
} from '../routing/MessageFlowRouting.js';
import {
  findEndpointParticipant,
  resolveMessageFlowEndpoint
} from '../EndpointResolution.js';

export function alignParticipantsHorizontally(
    collaboration,
    participantShapes,
    endpointShapes,
    connectionRoutes,
    channelOffsets,
    anchorPositionedParticipants,
    expandableParticipants) {
  const participants = collaboration.participants || [];
  const processParticipants = participants.filter(participant => participant.processRef);
  const anchorParticipant = processParticipants.reduce((largest, participant) => {
    if (!largest) {
      return participant;
    }

    const rect = participantShapes.get(participant);
    const largestRect = participantShapes.get(largest);

    return rect.width * rect.height > largestRect.width * largestRect.height
      ? participant
      : largest;
  }, null);
  const movableParticipants = processParticipants.filter(participant => {
    return participant !== anchorParticipant;
  });
  const initialPositions = new Map(participants.map(participant => {
    return [ participant, participantShapes.get(participant).x ];
  }));
  const positions = new Map(initialPositions);
  const scoreCache = new Map();
  const scorePositions = candidatePositions => {
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

    return scoreCache.get(key);
  };
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
        record.sourceParticipant &&
        record.targetParticipant &&
        record.sourceParticipant !== record.targetParticipant &&
        (
          movableParticipants.includes(record.sourceParticipant) ||
          movableParticipants.includes(record.targetParticipant)
        );
  });

  if (!endpointRecords.length) {
    return positions;
  }

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

  let currentScore = scorePositions(positions);
  let changed;

  do {
    changed = false;

    for (const participant of movableParticipants) {
      const candidates = [ positions.get(participant) ];

      for (const record of endpointRecords) {
        if (record.sourceParticipant === participant) {
          for (const sourceOffset of localIntervals.get(record.source)) {
            for (const targetOffset of localIntervals.get(record.target)) {
              candidates.push(Math.round(
                positions.get(record.targetParticipant) +
                targetOffset -
                sourceOffset
              ));
            }
          }
        } else if (record.targetParticipant === participant) {
          for (const sourceOffset of localIntervals.get(record.source)) {
            for (const targetOffset of localIntervals.get(record.target)) {
              candidates.push(Math.round(
                positions.get(record.sourceParticipant) +
                sourceOffset -
                targetOffset
              ));
            }
          }
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

function getLocalHorizontalInterval(
    element,
    participant,
    endpointShapes,
    participantShapes) {
  const rect = endpointShapes.get(element);
  const participantBounds = participantShapes.get(participant);

  if (is(element, 'bpmn:Participant')) {
    const inset = ROUTING_MARGIN + MESSAGE_FLOW_SIDE_OFFSET;

    return [ inset, participantBounds.width - inset ];
  }

  return [ rect.x + rect.width / 2 - participantBounds.x ];
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
  const bendCount = [ ...routes.values() ].filter(points => points.length > 2).length;

  const routeCosts = [ ...routes.values() ].map(points => {
    const bendCost = points.length > 2 ? MESSAGE_FLOW_BEND_PENALTY : 0;

    return routeLength(points) + bendCost;
  });
  const routingCost = routeCosts.reduce((total, cost) => total + cost, 0);
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
