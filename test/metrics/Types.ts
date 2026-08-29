import type { ModdleElement } from 'moddle';

import type {
  BpmnElement,
  BpmnElementFor,
  BpmndiElementFor
} from '../../lib/layout/bpmn/Types.js';
import type {
  DcBounds,
  DcPoint
} from '../../lib/moddle-types/dc.js';

export type MetricId = string | undefined;

export type MetricBounds = Required<Pick<
  DcBounds,
  'x' | 'y' | 'width' | 'height'
>>;

export type MetricWaypoint = Required<Pick<DcPoint, 'x' | 'y'>>;

export type MetricDiBounds = ModdleElement<MetricBounds>;

export type MetricDiWaypoint = ModdleElement<MetricWaypoint>;

export type BpmnDiagram = NonNullable<
  BpmnElementFor<'bpmn:Definitions'>['diagrams']
>[number];

export type BpmnPlane = NonNullable<BpmnDiagram['plane']>;

export type BpmnShape = BpmndiElementFor<'bpmndi:BPMNShape'>;

export type BpmnEdge = BpmndiElementFor<'bpmndi:BPMNEdge'>;

export type BpmnLabel = NonNullable<BpmnShape['label']>;

export type BoundedBpmnShape = BpmnShape & {
  bounds: MetricDiBounds;
};

export type RoutedBpmnEdge = Omit<BpmnEdge, 'waypoint'> & {
  waypoint: MetricDiWaypoint[];
};

export type MetricShape = MetricBounds & {
  id: MetricId;
  isFlowNode: boolean;
  isEvent: boolean;
  isGateway: boolean;
  labelBounds: MetricBounds | null;
  isBoundary: boolean;
  isArtifact: boolean;
  isContainer: boolean;
};

export type MetricEdge = {
  id: MetricId;
  sourceId: MetricId;
  targetId: MetricId;
  isSequenceFlow: boolean;
  isMessageFlow: boolean;
  hasLabel: boolean;
  name: string | undefined;
  isDefault: boolean;
  labelBounds: MetricBounds | null;
  waypoints: MetricWaypoint[];
};

export type MetricPlane = {
  shapes: MetricShape[];
  edges: MetricEdge[];
};

export type MetricSegment = [MetricWaypoint, MetricWaypoint];

export type MetricDockingSide = 'top' | 'bottom' | 'left' | 'right';

export type MetricLabelBounds = MetricBounds & {
  ownerId: MetricId;
};

export type BacktrackingTurn = {
  previous: MetricWaypoint;
  waypoint: MetricWaypoint;
  next: MetricWaypoint;
};

export type CrossingFinding = {
  edgeIds: [ MetricId, MetricId ];
  point: MetricWaypoint;
};

export type ParallelEdgeOverlapFinding = {
  edgeIds: [ MetricId, MetricId ];
  segments: [ MetricSegment, MetricSegment ];
  separation: number;
};

export type OverlapFinding = {
  shapeIds: [ MetricId, MetricId ];
  bounds: MetricBounds;
};

export type EdgeShapeIntersectionFinding = {
  edgeId: MetricId;
  shapeId: MetricId;
  bounds: MetricBounds;
};

export type DockingFinding = {
  edgeId: MetricId;
  endpoint: MetricWaypoint | null;
  shapeId: MetricId | null;
};

export type NonOrthogonalConnectionFinding = {
  edgeId: MetricId;
  segments: MetricSegment[];
};

export type BacktrackingConnectionFinding = {
  edgeId: MetricId;
  turns: BacktrackingTurn[];
};

export type LabelShapeOverlapFinding = {
  label: MetricLabelBounds;
  shapeId: MetricId;
};

export type LabelEdgeOverlapFinding = {
  label: MetricLabelBounds;
  edgeId: MetricId;
};

export type MetricFindings = {
  crossings: CrossingFinding[];
  parallelEdgeOverlaps: ParallelEdgeOverlapFinding[];
  overlaps: OverlapFinding[];
  edgeShapeIntersections: EdgeShapeIntersectionFinding[];
  detachedDockings: DockingFinding[];
  wrongWayDockings: DockingFinding[];
  nonOrthogonalConnections: NonOrthogonalConnectionFinding[];
  backtrackingConnections: BacktrackingConnectionFinding[];
  labelShapeOverlaps: LabelShapeOverlapFinding[];
  labelEdgeOverlaps: LabelEdgeOverlapFinding[];
};

export type LayoutMetrics = {
  shapeCount: number;
  edgeCount: number;
  crossings: number;
  parallelEdgeOverlaps: number;
  overlaps: number;
  edgeShapeIntersections: number;
  detachedDockings: number;
  wrongWayDockings: number;
  nonOrthogonalConnections: number;
  backtrackingConnections: number;
  bendCount: number;
  averageEdgeLength: number;
  edgeSegmentLengthDeviation: number;
  labelShapeOverlaps: number;
  labelEdgeOverlaps: number;
  compactness: number;
  gridAlignment: number;
  branchSymmetry: number;
};

export type MetricAnalysis = {
  metrics: LayoutMetrics;
  findings: MetricFindings;
};

export type MetricElement = BpmnElement;
