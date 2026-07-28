import type { LayoutWarning } from '../LayoutWarning.js';
import type {
  Point,
  Rect
} from 'diagram-js/lib/util/Types.js';

export type BpmnElement = {
  id?: string;
  $type?: string;
  $parent?: BpmnElement;
  $instanceOf?(type: string): boolean;
} & Record<string, any>;

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
};

export type RankAssignment = {
  rank: Map<BpmnElement, number>;
};

export type ProcessLayoutStep = (
  context: ProcessLayoutContext
) => ProcessLayoutContext;

export type ProcessLayoutOptions = {
  expandedIds: Set<string>;
  participantProcess: boolean;
  messageFlowEndpointDirections: Map<BpmnElement, Set<string>>;
  steps: ReadonlyArray<ProcessLayoutStep>;
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
