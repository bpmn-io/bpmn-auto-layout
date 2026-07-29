import { createLayout } from '../geometry/index.js';
import {
  orderParticipants
} from './ordering/ParticipantOrdering.js';
import {
  positionParticipants
} from './placement/ParticipantPlacement.js';
import {
  routeMessageFlows
} from './routing/MessageFlowRouting.js';
import { compactParticipantRows } from './steps/compactParticipantRows.js';
import { layoutParticipants } from './steps/layoutParticipants.js';
import { placeArtifacts } from './steps/placeArtifacts.js';
import {
  validateCollaboration
} from './steps/validateCollaboration.js';

/**
 * @typedef {import('../Types.js').CollaborationLayoutStep} CollaborationLayoutStep
 */

/** @type {ReadonlyArray<CollaborationLayoutStep>} */
const COLLABORATION_LAYOUT_STEPS = Object.freeze([
  validateCollaboration,
  layoutParticipants,
  orderParticipants,
  positionParticipants,
  compactParticipantRows,
  routeMessageFlows,
  placeArtifacts
]);

export function layoutCollaboration(collaboration, options = {}) {
  const context = createCollaborationLayoutContext(collaboration, options);
  const completed = COLLABORATION_LAYOUT_STEPS.reduce((current, runStep) => {
    return runStep(current);
  }, context);

  return {
    layout: completed.layout,
    warnings: completed.warnings
  };
}

function createCollaborationLayoutContext(
    collaboration,
    {
      expandedIds = new Set()
    }) {
  return {
    collaboration,
    options: {
      expandedIds
    },
    participants: {
      layouts: new Map(),
      anchorPositioned: new Set(),
      expandable: new Set(),
      order: []
    },
    routing: {
      endpointDirections: new Map(),
      channelOffsets: new Map()
    },
    layout: createLayout(collaboration),
    warnings: []
  };
}
