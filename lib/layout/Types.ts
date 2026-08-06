import type { LayoutWarning } from '../LayoutWarning.js';
import type {
  Point,
  Rect
} from 'diagram-js/lib/util/Types.js';

import type { BpmnElement } from './bpmn/Types.js';

export type { BpmnElement } from './bpmn/Types.js';

export type Bounds = Rect;

export type Waypoint = Point;

export type LayoutState = {
  scope: BpmnElement;
  shapes: Map<BpmnElement, Bounds>;
  edges: Map<BpmnElement, Waypoint[]>;
  children: LayoutState[];
  emitInParent: boolean;
};

export type LayoutRecord = {
  element: BpmnElement;
  index: number;
  size: {
    width: number;
    height: number;
  };
  isBoundary: boolean;
  isArtifact: boolean;
  expanded: boolean;
  child: LayoutState | null;
  bounds?: Bounds;
};

export type FeedbackBranch = {
  entry: BpmnElement;
  nodes: Set<BpmnElement>;
  returnEdges: Set<BpmnElement>;
  maximumReturnDepth: number;
};

export type FeedbackRegion = {
  split: BpmnElement;
  branches: FeedbackBranch[];
  children: FeedbackRegion[];
};

export type SemanticPolicy = {
  spine: Set<BpmnElement>;
  straightEdges: Set<BpmnElement>;
  bands: Map<BpmnElement, number>;
  components: Map<BpmnElement, number>;
  edgeOrder: Map<BpmnElement, number>;
  flowNodeDocumentIndex: Map<BpmnElement, number>;
  graphEdges: BpmnElement[];
  compactFlowRegions: unknown[];
  rankWeights: Map<BpmnElement, number>;
  backEdges: Set<BpmnElement>;
  boundaryBayEdges: Set<BpmnElement>;
  compactFeedbackNodes?: Set<BpmnElement>;
  feedbackBranchDepths?: Map<BpmnElement, number>;
  innerFeedbackEdges?: Set<BpmnElement>;
  nestedFeedbackLevels?: Map<BpmnElement, number>;
  feedbackRegions: FeedbackRegion[];
};

export type RankAssignment = {
  rank: Map<BpmnElement, number>;
};

export type ProcessLayoutStep = (
  context: ProcessLayoutContext
) => ProcessLayoutContext;

export type ProcessLayoutResult = {
  primaryPathDiagnostics: PrimaryPathDiagnostic[];
  layout: LayoutState;
  semantics: ProcessSemantics;
  warnings: LayoutWarning[];
};

export type ProcessLayoutOptions = {
  expandedIds: Set<string>;
  participantProcess: boolean;
  messageFlowEndpointDirections: Map<BpmnElement, Set<string>>;
  primaryEdgeOverrides: Map<BpmnElement, BpmnElement>;
  optimizePrimaryPaths: boolean;
  primaryPathDiagnostics: PrimaryPathDiagnostic[];
  layoutScope: (
    scope: BpmnElement,
    options?: Partial<ProcessLayoutOptions>
  ) => ProcessLayoutResult;
};

export type PrimaryPathDiagnostic = {
  gatewayId: string | undefined;
  edgeId: string | undefined;
  score: number[];
  status: 'accepted' | 'rejected-hard-defect' | 'rejected-quality';
};

export type ProcessElements = {
  groups: BpmnElement[];
  sequenceFlows: BpmnElement[];
  associations: BpmnElement[];
};

export type ProcessPlacement = {
  records: LayoutRecord[];
  recordsByElement: Map<BpmnElement, LayoutRecord>;
};

export type ProcessGraph = {
  nodes: BpmnElement[];
  edges: BpmnElement[];
  boundaryEdges: BpmnElement[];
};

export type ProcessSemantics = {
  policy: SemanticPolicy | null;
  ranks: RankAssignment | null;
};

export type ProcessLayoutContext = {
  scope: BpmnElement;
  options: ProcessLayoutOptions;
  elements: ProcessElements;
  graph: ProcessGraph;
  semantics: ProcessSemantics;
  placement: ProcessPlacement;
  layout: LayoutState;
  warnings: LayoutWarning[];
};

export type CollaborationLayoutStep = (
  context: CollaborationLayoutContext
) => CollaborationLayoutContext;

export type CollaborationLayoutOptions = {
  expandedIds: Set<string>;
  optimizeCollaboration: boolean;
  optimizePrimaryPaths: boolean;
  primaryEdgeOverrides: Map<BpmnElement, BpmnElement>;
  layoutCollaboration: (
    collaboration: BpmnElement,
    options?: Partial<CollaborationLayoutOptions>
  ) => ProcessLayoutResult;
};

export type CollaborationLayoutContext = {
  collaboration: BpmnElement;
  options: CollaborationLayoutOptions;
  participants: {
    layouts: Map<BpmnElement, LayoutState>;
    anchorPositioned: Set<BpmnElement>;
    expandable: Set<BpmnElement>;
    order: BpmnElement[];
    semantics: Map<BpmnElement, ProcessSemantics>;
  };
  routing: {
    endpointDirections: Map<BpmnElement, Set<string>>;
    channelOffsets: Map<BpmnElement, number>;
  };
  layout: LayoutState;
  warnings: LayoutWarning[];
  primaryPathDiagnostics: PrimaryPathDiagnostic[];
};
