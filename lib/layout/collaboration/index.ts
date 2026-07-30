import { createLayout } from '../geometry/index.js';
import {
  layoutParticipantGeometry
} from './ParticipantGeometry.js';
import {
  routeMessageFlows
} from './routing/MessageFlowRouting.js';
import { layoutParticipants } from './steps/layoutParticipants.js';
import { placeArtifacts } from './steps/placeArtifacts.js';
import {
  validateCollaboration
} from './steps/validateCollaboration.js';

import type {
  BpmnElement,
  CollaborationLayoutContext,
  CollaborationLayoutOptions,
  CollaborationLayoutStep,
  ProcessLayoutResult
} from '../Types.js';

const COLLABORATION_LAYOUT_STEPS: readonly CollaborationLayoutStep[] = Object.freeze([
  validateCollaboration,
  layoutParticipants,
  layoutParticipantGeometry,
  routeMessageFlows,
  placeArtifacts
]);

export function layoutCollaboration(
    collaboration: BpmnElement,
    options: Partial<CollaborationLayoutOptions> = {}
): ProcessLayoutResult {
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
    collaboration: BpmnElement,
    {
      expandedIds = new Set<string>()
    }: Partial<CollaborationLayoutOptions>
): CollaborationLayoutContext {
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
