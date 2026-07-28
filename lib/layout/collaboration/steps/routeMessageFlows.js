import {
  includeResizableParticipantMessageDocks
} from '../placement/ParticipantPlacement.js';
import {
  getMessageObstacles,
  routeMessageFlows as routeAllMessageFlows
} from '../routing/MessageFlowRouting.js';
import { collectCollaborationShapes } from '../Helpers.js';

/**
 * @typedef {import('../../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 */

/**
 * @param {CollaborationLayoutContext} context
 * @returns {CollaborationLayoutContext}
 */
export function routeMessageFlows(context) {
  const { collaboration, layout } = context;
  const { expandable } = context.participants;
  const { channelOffsets } = context.routing;
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
