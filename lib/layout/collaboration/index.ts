import { createLayout } from '../geometry/index.js';
import {
  layoutParticipantGeometry
} from './ParticipantGeometry.js';
import {
  routeMessageFlows
} from './routing/MessageFlowRouting.js';
import { layoutParticipants } from './steps/layoutParticipants.js';
import { placeArtifacts } from './steps/placeArtifacts.js';
import { optimizeCollaborationLayout } from './steps/optimizeCollaborationLayout.js';
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
  placeArtifacts,
  optimizeCollaborationLayout
]);

export function layoutCollaboration(
    collaboration: BpmnElement,
    options: Partial<CollaborationLayoutOptions> = {}
): ProcessLayoutResult {
  const layoutScope = (
      childCollaboration: BpmnElement,
      childOptions: Partial<CollaborationLayoutOptions> = {}
  ) => {
    return layoutCollaboration(childCollaboration, childOptions);
  };
  const context = createCollaborationLayoutContext(collaboration, {
    ...options,
    layoutCollaboration: layoutScope
  });
  const steps = context.options.optimizeCollaboration
    ? COLLABORATION_LAYOUT_STEPS
    : COLLABORATION_LAYOUT_STEPS.filter(step => {
      return step !== optimizeCollaborationLayout;
    });
  const completed = steps.reduce((current, runStep) => {
    return runStep(current);
  }, context);

  return {
    primaryPathDiagnostics: completed.primaryPathDiagnostics,
    layout: completed.layout,
    semantics: {
      policy: null,
      ranks: null
    },
    warnings: completed.warnings
  };
}

function createCollaborationLayoutContext(
    collaboration: BpmnElement,
    {
      expandedIds = new Set<string>(),
      layoutCollaboration,
      optimizeCollaboration = true,
      optimizePrimaryPaths = true,
      primaryEdgeOverrides = new Map()
    }: Partial<CollaborationLayoutOptions>
): CollaborationLayoutContext {
  return {
    collaboration,
    options: {
      expandedIds,
      layoutCollaboration: getRequired(layoutCollaboration),
      optimizeCollaboration,
      optimizePrimaryPaths,
      primaryEdgeOverrides
    },
    participants: {
      layouts: new Map(),
      anchorPositioned: new Set(),
      expandable: new Set(),
      order: [],
      semantics: new Map()
    },
    routing: {
      endpointDirections: new Map(),
      channelOffsets: new Map()
    },
    layout: createLayout(collaboration),
    warnings: [],
    primaryPathDiagnostics: []
  };
}

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected collaboration layout option');
  }

  return value;
}
