import { BpmnModdle } from 'bpmn-moddle';

import { FLOW_LABEL_INDENT, MIN_PARALLEL_EDGE_SEPARATION } from '../../lib/layout/Constants.js';
import { externalLabelSize } from '../../lib/layout/labels/LayoutLabels.js';
import {
  isBpmndiType,
  isBpmnType
} from '../../lib/layout/bpmn/Types.js';

import type {
  BoundedBpmnShape,
  BpmnDiagram,
  BpmnEdge,
  BpmnLabel,
  BpmnPlane,
  BpmnShape,
  DockingFinding,
  LayoutMetrics,
  MetricAnalysis,
  MetricBounds,
  MetricDockingSide,
  MetricDiBounds,
  MetricDiWaypoint,
  MetricEdge,
  MetricElement,
  MetricFindings,
  MetricId,
  MetricLabelBounds,
  MetricPlane,
  MetricSegment,
  MetricShape,
  MetricWaypoint,
  NonOrthogonalConnectionFinding,
  RoutedBpmnEdge
} from './Types.js';

const moddle = new BpmnModdle();

/**
 * Compute layout-quality metrics for a laid-out BPMN diagram.
 *
 * Band-A (ambiguity — hard) numbers, i.e. defects that make a human read the
 * *wrong* process:
 *
 * - `overlaps`               — node pairs whose bounds overlap, excluding
 *                              legitimate container nesting, boundary-on-host,
 *                              and artifacts.
 * - `edgeShapeIntersections` — (edge, unrelated shape) pairs where the edge
 *                              interior passes through the shape; text
 *                              artifacts are not obstacles.
 * - `detachedDockings`       — edge endpoints that do not touch their shape.
 * - `wrongWayDockings`       — attached edge endpoints whose adjacent segment
 *                              enters the endpoint shape.
 * - `nonOrthogonalConnections` — sequence and message flows containing at
 *                                least one diagonal segment.
 * - `backtrackingConnections` — sequence and message flows containing at
 *                               least one 180-degree turn.
 *
 * Band-C (polish — informational) numbers:
 *
 * - `crossings`                   — edge-segment pairs that properly cross.
 * - `parallelEdgeOverlaps`        — unrelated edge-segment pairs that run
 *                                   parallel and overlapping within
 *                                   `MIN_PARALLEL_EDGE_SEPARATION`, so the two
 *                                   edges read as a single doubled line.
 * - `bendCount`                   — direction changes in edge waypoint paths.
 * - `averageEdgeLength`           — average edge waypoint-polyline length.
 * - `edgeSegmentLengthDeviation`  — standard deviation of segment lengths.
 * - `labelShapeOverlaps`          — external labels that overlap non-container
 *                                   flow-node shapes.
 * - `labelEdgeOverlaps`           — labels that overlap connection interiors.
 * - `compactness`                 — flow-node area as a percentage of the
 *                                   flow-node and sequence-flow bounding box.
 * - `gridAlignment`               — percentage of flow nodes participating in
 *                                   a horizontal or vertical alignment of at
 *                                   least three nodes.
 * - `branchSymmetry`              — percentage of targets in non-default
 *                                   gateway fans that reflect across the
 *                                   gateway's horizontal axis.
 *
 */
export async function computeMetrics(xml: string): Promise<LayoutMetrics> {
  return (await analyzeMetrics(xml)).metrics;
}

export async function analyzeMetrics(xml: string): Promise<MetricAnalysis> {
  const { rootElement: definitions } = await moddle.fromXML(xml);

  const planes: MetricPlane[] = [];

  const diagrams: readonly BpmnDiagram[] = definitions.diagrams || [];

  for (const diagram of diagrams) {
    const plane: BpmnPlane | undefined = diagram.plane;

    if (!plane) {
      continue;
    }

    const shapes: MetricShape[] = [];
    const edges: MetricEdge[] = [];

    for (const di of plane.planeElement || []) {
      if (
        isBpmndiType(di, 'bpmndi:BPMNShape') &&
        hasMetricBounds(di)
      ) {
        shapes.push(toShape(di));
      } else if (
        isBpmndiType(di, 'bpmndi:BPMNEdge') &&
        hasMetricWaypoints(di)
      ) {
        edges.push(toEdge(di));
      }
    }

    planes.push({ shapes, edges });
  }

  const findings: MetricFindings = {
    crossings: planes.flatMap(plane => findCrossings(plane.edges)),
    parallelEdgeOverlaps: planes.flatMap(plane => findParallelEdgeOverlaps(plane.edges)),
    overlaps: planes.flatMap(plane => findOverlaps(plane.shapes)),
    edgeShapeIntersections: planes.flatMap(plane => findEdgeShapeIntersections(plane.edges, plane.shapes)),
    detachedDockings: planes.flatMap(plane => findDetachedDockings(plane.edges, plane.shapes)),
    wrongWayDockings: planes.flatMap(plane => findWrongWayDockings(plane.edges, plane.shapes)),
    nonOrthogonalConnections: planes.flatMap(plane => findNonOrthogonalConnections(plane.edges)),
    backtrackingConnections: planes.flatMap(plane => findBacktrackingConnections(plane.edges)),
    labelShapeOverlaps: planes.flatMap(plane => findLabelShapeOverlaps(plane.shapes, plane.edges)),
    labelEdgeOverlaps: planes.flatMap(plane => findLabelEdgeOverlaps(plane.shapes, plane.edges))
  };

  return {
    metrics: {
    shapeCount: sum(planes, plane => plane.shapes.length),
    edgeCount: sum(planes, plane => plane.edges.length),
    crossings: findings.crossings.length,
    parallelEdgeOverlaps: findings.parallelEdgeOverlaps.length,
    overlaps: findings.overlaps.length,
    edgeShapeIntersections: findings.edgeShapeIntersections.length,
    detachedDockings: findings.detachedDockings.length,
    wrongWayDockings: findings.wrongWayDockings.length,
    nonOrthogonalConnections: findings.nonOrthogonalConnections.length,
    backtrackingConnections: findings.backtrackingConnections.length,
    bendCount: sum(planes, plane => countBends(plane.edges)),
    averageEdgeLength: averageEdgeLength(planes.flatMap(plane => plane.edges)),
    edgeSegmentLengthDeviation: roundScore(segmentLengthDeviation(planes)),
    labelShapeOverlaps: findings.labelShapeOverlaps.length,
    labelEdgeOverlaps: findings.labelEdgeOverlaps.length,
    compactness: roundScore(compactness(planes)),
    gridAlignment: roundScore(gridAlignment(planes)),
    branchSymmetry: roundScore(branchSymmetry(planes))
    },
    findings
  };
}

function sum<Item>(
    items: readonly Item[],
    mapper: (item: Item) => number
): number {
  return items.reduce((total, item) => total + mapper(item), 0);
}


// shape extraction ////////////////////////////////////////////////

function toShape(di: BoundedBpmnShape): MetricShape {
  const element = di.bpmnElement;
  const { x, y, width, height } = di.bounds;

  return {
    id: element?.id,
    x, y, width, height,
    isFlowNode: isBpmnType(element, 'bpmn:FlowNode'),
    isEvent: isBpmnType(element, 'bpmn:Event'),
    isGateway: isBpmnType(element, 'bpmn:Gateway'),
    labelBounds: toLabelBounds(di.label),
    isBoundary: isBpmnType(element, 'bpmn:BoundaryEvent'),
    isArtifact: isBpmnType(element, 'bpmn:TextAnnotation') ||
      isBpmnType(element, 'bpmn:DataObjectReference') ||
      isBpmnType(element, 'bpmn:DataStoreReference') ||
      isBpmnType(element, 'bpmn:Group'),
    isContainer:
      di.isExpanded === true ||
      isBpmnType(element, 'bpmn:Participant') ||
      isBpmnType(element, 'bpmn:Lane') ||
      isBpmnType(element, 'bpmn:Group')
  };
}

function toEdge(di: RoutedBpmnEdge): MetricEdge {
  const element = di.bpmnElement;
  const name = elementName(element);

  return {
    id: element?.id,
    sourceId: sourceId(element),
    targetId: targetId(element),
    isSequenceFlow: isBpmnType(element, 'bpmn:SequenceFlow'),
    isMessageFlow: isBpmnType(element, 'bpmn:MessageFlow'),
    hasLabel: typeof name === 'string' && name.trim().length > 0,
    name,
    isDefault: isDefaultSequenceFlow(element),
    labelBounds: toLabelBounds(di.label),
    waypoints: di.waypoint.map(({ x, y }) => ({ x, y }))
  };
}

function toLabelBounds(label: BpmnLabel | undefined): MetricBounds | null {
  if (!label || !isMetricBounds(label.bounds)) {
    return null;
  }

  const { x, y, width, height } = label.bounds;

  return { x, y, width, height };
}

function hasMetricBounds(
    shape: BpmnShape
): shape is BoundedBpmnShape {
  return isMetricBounds(shape.bounds);
}

function isMetricBounds(
    bounds: BpmnShape['bounds'] | BpmnLabel['bounds']
): bounds is MetricDiBounds {
  return !!bounds &&
    typeof bounds.x === 'number' &&
    typeof bounds.y === 'number' &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number';
}

function hasMetricWaypoints(edge: BpmnEdge): edge is RoutedBpmnEdge {
  return !!edge.waypoint && edge.waypoint.every(isMetricWaypoint);
}

function isMetricWaypoint(
    waypoint: NonNullable<BpmnEdge['waypoint']>[number]
): waypoint is MetricDiWaypoint {
  return typeof waypoint.x === 'number' && typeof waypoint.y === 'number';
}

function sourceId(element: MetricElement | undefined): MetricId {
  if (
    isBpmnType(element, 'bpmn:SequenceFlow') ||
    isBpmnType(element, 'bpmn:MessageFlow') ||
    isBpmnType(element, 'bpmn:Association') ||
    isBpmnType(element, 'bpmn:ConversationLink')
  ) {
    return elementId(element.sourceRef);
  }

  return undefined;
}

function targetId(element: MetricElement | undefined): MetricId {
  if (
    isBpmnType(element, 'bpmn:SequenceFlow') ||
    isBpmnType(element, 'bpmn:MessageFlow') ||
    isBpmnType(element, 'bpmn:Association') ||
    isBpmnType(element, 'bpmn:ConversationLink') ||
    isBpmnType(element, 'bpmn:DataAssociation')
  ) {
    return elementId(element.targetRef);
  }

  return undefined;
}

function elementId(element: MetricElement | undefined): MetricId {
  return typeof element?.id === 'string'
    ? element.id
    : undefined;
}

function elementName(element: MetricElement | undefined): string | undefined {
  if (!element || !('name' in element) || typeof element.name !== 'string') {
    return undefined;
  }

  return element.name;
}

function isDefaultSequenceFlow(element: MetricElement | undefined): boolean {
  if (!isBpmnType(element, 'bpmn:SequenceFlow') || !element.sourceRef) {
    return false;
  }

  const source = element.sourceRef;

  return (
    isBpmnType(source, 'bpmn:Activity') ||
    isBpmnType(source, 'bpmn:ComplexGateway') ||
    isBpmnType(source, 'bpmn:ExclusiveGateway') ||
    isBpmnType(source, 'bpmn:InclusiveGateway')
  ) && source.default === element;
}


// connection orthogonality /////////////////////////////////////////

const ORTHOGONAL_TOLERANCE = 1e-6;

function findNonOrthogonalConnections(
    edges: readonly MetricEdge[]
): NonOrthogonalConnectionFinding[] {
  const findings: NonOrthogonalConnectionFinding[] = [];

  for (const edge of edges) {
    if (!edge.isSequenceFlow && !edge.isMessageFlow) {
      continue;
    }

    const segments = toSegments(edge.waypoints)
      .filter(([ start, end ]) => {
        return Math.abs(start.x - end.x) > ORTHOGONAL_TOLERANCE &&
          Math.abs(start.y - end.y) > ORTHOGONAL_TOLERANCE;
      });

    if (segments.length) {
      findings.push({ edgeId: edge.id, segments });
    }
  }

  return findings;
}

function findBacktrackingConnections(
    edges: readonly MetricEdge[]
): MetricFindings['backtrackingConnections'] {
  const findings: MetricFindings['backtrackingConnections'] = [];

  for (const edge of edges) {
    if (!edge.isSequenceFlow && !edge.isMessageFlow) {
      continue;
    }

    const turns: MetricFindings['backtrackingConnections'][number]['turns'] = [];
    const waypoints = removeConsecutiveDuplicates(edge.waypoints);

    for (let index = 1; index < waypoints.length - 1; index++) {
      const previous = waypoints[index - 1];
      const waypoint = waypoints[index];
      const next = waypoints[index + 1];
      const incoming = {
        x: waypoint.x - previous.x,
        y: waypoint.y - previous.y
      };
      const outgoing = {
        x: next.x - waypoint.x,
        y: next.y - waypoint.y
      };
      const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
      const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;

      if (Math.abs(cross) <= ORTHOGONAL_TOLERANCE && dot < 0) {
        turns.push({ previous, waypoint, next });
      }
    }

    if (turns.length) {
      findings.push({ edgeId: edge.id, turns });
    }
  }

  return findings;
}


// node overlaps ///////////////////////////////////////////////////

function findOverlaps(
    shapes: readonly MetricShape[]
): MetricFindings['overlaps'] {
  const findings: MetricFindings['overlaps'] = [];

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];

      // boundary events legitimately straddle their host
      if (a.isBoundary || b.isBoundary || a.isArtifact || b.isArtifact) {
        continue;
      }

      if (!rectanglesOverlap(a, b)) {
        continue;
      }

      // a container legitimately contains its children
      if (a.isContainer && contains(a, b)) {
        continue;
      }

      if (b.isContainer && contains(b, a)) {
        continue;
      }

      findings.push({
        shapeIds: [ a.id, b.id ],
        bounds: intersectionBounds(a, b)
      });
    }
  }

  return findings;
}

function rectanglesOverlap(a: MetricBounds, b: MetricBounds): boolean {
  return a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
}

function contains(outer: MetricBounds, inner: MetricBounds): boolean {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function intersectionBounds(a: MetricBounds, b: MetricBounds): MetricBounds {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);

  return {
    x,
    y,
    width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y
  };
}


// edge crossings //////////////////////////////////////////////////

function findCrossings(
    edges: readonly MetricEdge[]
): MetricFindings['crossings'] {
  const segments = edges.map(edge => toSegments(edge.waypoints));

  const findings: MetricFindings['crossings'] = [];

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      for (const s of segments[i]) {
        for (const t of segments[j]) {
          if (segmentsProperlyCross(s[0], s[1], t[0], t[1])) {
            findings.push({
              edgeIds: [ edges[i].id, edges[j].id ],
              point: segmentIntersection(s[0], s[1], t[0], t[1])
            });
          }
        }
      }
    }
  }

  return findings;
}

function toSegments(waypoints: readonly MetricWaypoint[]): MetricSegment[] {
  const segments: MetricSegment[] = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    segments.push([ waypoints[i], waypoints[i + 1] ]);
  }

  return segments;
}

/**
 * Near-parallel overlap: two unrelated edges whose axis-aligned segments run
 * in the same orientation, overlap along their shared axis, and sit closer
 * than `MIN_PARALLEL_EDGE_SEPARATION` on the perpendicular axis. Such a pair
 * renders as a single doubled line and is unreadable. Edges that share an
 * endpoint node legitimately converge in a shared docking channel and are
 * excluded.
 */
function findParallelEdgeOverlaps(
    edges: readonly MetricEdge[]
): MetricFindings['parallelEdgeOverlaps'] {
  const segments = edges.map(edge => toSegments(edge.waypoints));
  const findings: MetricFindings['parallelEdgeOverlaps'] = [];

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edgesShareEndpoint(edges[i], edges[j])) {
        continue;
      }

      for (const s of segments[i]) {
        for (const t of segments[j]) {
          const separation = parallelSegmentSeparation(s, t);

          if (separation !== null) {
            findings.push({
              edgeIds: [ edges[i].id, edges[j].id ],
              segments: [ s, t ],
              separation
            });
          }
        }
      }
    }
  }

  return findings;
}

function edgesShareEndpoint(a: MetricEdge, b: MetricEdge): boolean {
  return a.sourceId === b.sourceId ||
    a.sourceId === b.targetId ||
    a.targetId === b.sourceId ||
    a.targetId === b.targetId;
}

/**
 * Perpendicular separation of two axis-aligned segments when they run parallel
 * and overlap along their shared axis closer than the lane threshold; `null`
 * otherwise. Zero separation (exact collinear overlap) is included — fully
 * coincident unrelated edges are the worst case.
 */
function parallelSegmentSeparation(
    s: MetricSegment,
    t: MetricSegment
): number | null {
  const horizontal = s[0].y === s[1].y && t[0].y === t[1].y;
  const vertical = s[0].x === s[1].x && t[0].x === t[1].x;

  if (!horizontal && !vertical) {
    return null;
  }

  const separation = horizontal
    ? Math.abs(s[0].y - t[0].y)
    : Math.abs(s[0].x - t[0].x);

  if (separation >= MIN_PARALLEL_EDGE_SEPARATION) {
    return null;
  }

  const [ sStart, sEnd, tStart, tEnd ] = horizontal
    ? [
      Math.min(s[0].x, s[1].x),
      Math.max(s[0].x, s[1].x),
      Math.min(t[0].x, t[1].x),
      Math.max(t[0].x, t[1].x)
    ]
    : [
      Math.min(s[0].y, s[1].y),
      Math.max(s[0].y, s[1].y),
      Math.min(t[0].y, t[1].y),
      Math.max(t[0].y, t[1].y)
    ];

  return Math.min(sEnd, tEnd) - Math.max(sStart, tStart) > 0
    ? separation
    : null;
}

/**
 * Proper crossing: the segment interiors intersect. Shared endpoints (edges
 * meeting at a node), T-touches and collinear overlaps are NOT counted.
 */
function segmentsProperlyCross(
    p1: MetricWaypoint,
    p2: MetricWaypoint,
    p3: MetricWaypoint,
    p4: MetricWaypoint
): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function direction(
    a: MetricWaypoint,
    b: MetricWaypoint,
    c: MetricWaypoint
): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function segmentIntersection(
    a: MetricWaypoint,
    b: MetricWaypoint,
    c: MetricWaypoint,
    d: MetricWaypoint
): MetricWaypoint {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const cdX = d.x - c.x;
  const cdY = d.y - c.y;
  const denominator = abX * cdY - abY * cdX;
  const t = ((c.x - a.x) * cdY - (c.y - a.y) * cdX) / denominator;

  return {
    x: a.x + t * abX,
    y: a.y + t * abY
  };
}


// edge/shape intersections ////////////////////////////////////////

// perimeter docking and grazing along a shape edge are legitimate; only a
// genuine interior penetration deeper than this margin is an ambiguity defect.
const INTERSECTION_MARGIN = 2;

/**
 * Count (edge, shape) pairs where the edge interior passes through an unrelated
 * shape. The edge's own source and target are excluded, as are containers and
 * boundary events and text annotations.
 */
function findEdgeShapeIntersections(
    edges: readonly MetricEdge[],
    shapes: readonly MetricShape[]
): MetricFindings['edgeShapeIntersections'] {
  const findings: MetricFindings['edgeShapeIntersections'] = [];

  for (const edge of edges) {
    for (const shape of shapes) {
      if (shape.isContainer || shape.isBoundary || shape.isArtifact) {
        continue;
      }

      if (shape.id === edge.sourceId || shape.id === edge.targetId) {
        continue;
      }

      const rect = inset(shape, INTERSECTION_MARGIN);

      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      if (edgeEntersRect(edge.waypoints, rect)) {
        findings.push({
          edgeId: edge.id,
          shapeId: shape.id,
          bounds: rect
        });
      }
    }
  }

  return findings;
}

function inset(shape: MetricBounds, margin: number): MetricBounds {
  return {
    x: shape.x + margin,
    y: shape.y + margin,
    width: shape.width - 2 * margin,
    height: shape.height - 2 * margin
  };
}

function edgeEntersRect(
    waypoints: readonly MetricWaypoint[],
    rect: MetricBounds
): boolean {
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (segmentEntersRect(waypoints[i], waypoints[i + 1], rect)) {
      return true;
    }
  }

  return false;
}

/**
 * Liang–Barsky clip: true when the segment shares a positive-length interval
 * with the rectangle interior.
 */
function segmentEntersRect(
    p1: MetricWaypoint,
    p2: MetricWaypoint,
    rect: MetricBounds
): boolean {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const p = [ -dx, dx, -dy, dy ];
  const q = [
    p1.x - rect.x,
    rect.x + rect.width - p1.x,
    p1.y - rect.y,
    rect.y + rect.height - p1.y
  ];

  let t0 = 0;
  let t1 = 1;

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) {
        return false;
      }
    } else {
      const r = q[i] / p[i];

      if (p[i] < 0) {
        if (r > t1) {
          return false;
        }
        if (r > t0) {
          t0 = r;
        }
      } else {
        if (r < t0) {
          return false;
        }
        if (r < t1) {
          t1 = r;
        }
      }
    }
  }

  return t1 - t0 > 1e-6;
}


// endpoint docking //////////////////////////////////////////////////

const DOCKING_TOLERANCE = 1e-6;

function findDetachedDockings(
    edges: readonly MetricEdge[],
    shapes: readonly MetricShape[]
): DockingFinding[] {
  const shapeById = new Map<MetricId, MetricShape>(
    shapes.map(shape => [ shape.id, shape ])
  );
  const findings: DockingFinding[] = [];

  for (const edge of edges) {
    const source = shapeById.get(edge.sourceId);
    const target = shapeById.get(edge.targetId);
    const endpointPairs: [ MetricShape | undefined, MetricWaypoint | null ][] = [
      [ source, edge.waypoints[0] || null ],
      [ target, edge.waypoints.at(-1) || null ]
    ];

    for (const [ shape, endpoint ] of endpointPairs) {
      if (
        shape &&
        !shape.isArtifact &&
        (!endpoint || !isAttached(endpoint, shape))
      ) {
        findings.push({
          edgeId: edge.id,
          endpoint,
          shapeId: shape.id
        });
      }
    }
  }

  return findings;
}

function isAttached(endpoint: MetricWaypoint, shape: MetricShape): boolean {
  const radiusX = shape.width / 2;
  const radiusY = shape.height / 2;
  const offsetX = Math.abs(endpoint.x - shape.x - radiusX);
  const offsetY = Math.abs(endpoint.y - shape.y - radiusY);

  if (shape.isEvent) {
    return near(
      (offsetX / radiusX) ** 2 + (offsetY / radiusY) ** 2,
      1
    );
  }

  if (shape.isGateway) {
    return near(offsetX / radiusX + offsetY / radiusY, 1);
  }

  return dockingSides(endpoint, shape).length > 0;
}

function findWrongWayDockings(
    edges: readonly MetricEdge[],
    shapes: readonly MetricShape[]
): DockingFinding[] {
  const shapeById = new Map<MetricId, MetricShape>(
    shapes.map(shape => [ shape.id, shape ])
  );
  const findings: DockingFinding[] = [];

  for (const edge of edges) {
    if (edge.waypoints.length < 2) {
      findings.push({
        edgeId: edge.id,
        endpoint: edge.waypoints[0] || null,
        shapeId: null
      });
      continue;
    }

    const source = shapeById.get(edge.sourceId);
    const target = shapeById.get(edge.targetId);

    if (source && !source.isArtifact &&
        dockingIsWrong(edge.waypoints[0], edge.waypoints[1], source)) {
      findings.push({
        edgeId: edge.id,
        endpoint: edge.waypoints[0],
        shapeId: source.id
      });
    }

    const lastWaypoint = edge.waypoints[edge.waypoints.length - 1];
    const previousWaypoint = edge.waypoints[edge.waypoints.length - 2];

    if (target && !target.isArtifact && dockingIsWrong(
      lastWaypoint,
      previousWaypoint,
      target
    )) {
      findings.push({
        edgeId: edge.id,
        endpoint: lastWaypoint,
        shapeId: target.id
      });
    }
  }

  return findings;
}

function dockingIsWrong(
    endpoint: MetricWaypoint,
    adjacent: MetricWaypoint,
    shape: MetricShape
): boolean {
  const sides = dockingSides(endpoint, shape);

  return sides.length > 1 || (
    sides.length > 0 && !sides.some(side => {
    if (side === 'top') {
      return adjacent.y < endpoint.y;
    }
    if (side === 'bottom') {
      return adjacent.y > endpoint.y;
    }
    if (side === 'left') {
      return adjacent.x < endpoint.x;
    }

    return adjacent.x > endpoint.x;
    })
  );
}

function dockingSides(
    point: MetricWaypoint,
    shape: MetricShape
): MetricDockingSide[] {
  const sides: MetricDockingSide[] = [];
  const centerSides = shape.isEvent || shape.isGateway;
  const centerX = shape.x + shape.width / 2;
  const centerY = shape.y + shape.height / 2;

  if ((!centerSides && between(point.x, shape.x, shape.x + shape.width)) ||
      (centerSides && near(point.x, centerX))) {
    if (near(point.y, shape.y)) {
      sides.push('top');
    }
    if (near(point.y, shape.y + shape.height)) {
      sides.push('bottom');
    }
  }
  if ((!centerSides && between(point.y, shape.y, shape.y + shape.height)) ||
      (centerSides && near(point.y, centerY))) {
    if (near(point.x, shape.x)) {
      sides.push('left');
    }
    if (near(point.x, shape.x + shape.width)) {
      sides.push('right');
    }
  }

  return sides;
}

function between(value: number, min: number, max: number): boolean {
  return value >= min - DOCKING_TOLERANCE && value <= max + DOCKING_TOLERANCE;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= DOCKING_TOLERANCE;
}


// average edge length /////////////////////////////////////////////

function averageEdgeLength(edges: readonly MetricEdge[]): number {
  if (!edges.length) {
    return 0;
  }

  let total = 0;

  for (const { waypoints } of edges) {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];

      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  return roundScore(total / edges.length);
}


// label/shape overlaps /////////////////////////////////////////////

function findLabelShapeOverlaps(
    shapes: readonly MetricShape[],
    edges: readonly MetricEdge[]
): MetricFindings['labelShapeOverlaps'] {
  const labels = collectLabelBounds(shapes, edges);
  const obstacles = shapes.filter(shape => {
    return shape.isFlowNode && !shape.isContainer && !shape.isBoundary && !shape.isArtifact;
  });

  const findings: MetricFindings['labelShapeOverlaps'] = [];

  for (const label of labels) {
    for (const shape of obstacles) {
      if (rectanglesOverlap(label, shape)) {
        findings.push({
          label,
          shapeId: shape.id
        });
      }
    }
  }

  return findings;
}

function findLabelEdgeOverlaps(
    shapes: readonly MetricShape[],
    edges: readonly MetricEdge[]
): MetricFindings['labelEdgeOverlaps'] {
  const labels = collectLabelBounds(shapes, edges);
  const findings: MetricFindings['labelEdgeOverlaps'] = [];

  for (const label of labels) {
    for (const edge of edges) {
      if (edgeEntersRect(edge.waypoints, label)) {
        findings.push({
          label,
          edgeId: edge.id
        });
      }
    }
  }

  return findings;
}

function collectLabelBounds(
    shapes: readonly MetricShape[],
    edges: readonly MetricEdge[]
): MetricLabelBounds[] {
  return [
    ...shapes.flatMap(shape => {
      return shape.labelBounds ? [ {
        ...shape.labelBounds,
        ownerId: shape.id
      } ] : [];
    }),
    ...edges.flatMap(edge => {
      const bounds = edge.labelBounds || implicitFlowLabelBounds(edge);

      return bounds ? [ {
        ...bounds,
        ownerId: edge.id
      } ] : [];
    })
  ];
}

function implicitFlowLabelBounds(edge: MetricEdge): MetricBounds | null {
  if (!edge.hasLabel || !edge.waypoints.length || !edge.name) {
    return null;
  }

  const position = flowLabelPosition(edge.waypoints);
  const { width, height } = externalLabelSize(edge.name);

  return {
    x: position.x - width / 2,
    y: position.y - height / 2,
    width,
    height
  };
}

function flowLabelPosition(
    waypoints: readonly MetricWaypoint[]
): MetricWaypoint {
  const mid = waypoints.length / 2 - 1;
  const first = waypoints[Math.floor(mid)];
  const second = waypoints[Math.ceil(mid + 0.01)];
  const x = first.x + (second.x - first.x) / 2;
  const y = first.y + (second.y - first.y) / 2;

  return Math.abs(second.y - first.y) <= Math.abs(second.x - first.x)
    ? { x, y: y - FLOW_LABEL_INDENT }
    : { x: x + FLOW_LABEL_INDENT, y };
}

// polish metrics ///////////////////////////////////////////////////

const ALIGNMENT_SIZE = 3;
const POSITION_TOLERANCE = 1;
const SCORE_SCALE = 100;
const SCORE_PRECISION = 1;

function countBends(edges: readonly MetricEdge[]): number {
  return sum(edges, edge => {
    const waypoints = removeConsecutiveDuplicates(edge.waypoints);
    let bends = 0;

    for (let i = 1; i < waypoints.length - 1; i++) {
      if (changesDirection(waypoints[i - 1], waypoints[i], waypoints[i + 1])) {
        bends++;
      }
    }

    return bends;
  });
}

function changesDirection(
    a: MetricWaypoint,
    b: MetricWaypoint,
    c: MetricWaypoint
): boolean {
  const incoming = { x: b.x - a.x, y: b.y - a.y };
  const outgoing = { x: c.x - b.x, y: c.y - b.y };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;

  return cross !== 0 || dot < 0;
}

function removeConsecutiveDuplicates(
    points: readonly MetricWaypoint[]
): MetricWaypoint[] {
  return points.filter((point, index) => {
    return index === 0 ||
      point.x !== points[index - 1].x ||
      point.y !== points[index - 1].y;
  });
}

function segmentLengthDeviation(planes: readonly MetricPlane[]): number {
  const lengths = planes.flatMap(plane => {
    return plane.edges.flatMap(edge => {
      return toSegments(removeConsecutiveDuplicates(edge.waypoints))
        .map(([ a, b ]) => Math.hypot(b.x - a.x, b.y - a.y))
        .filter(length => length > 0);
    });
  });

  if (!lengths.length) {
    return 0;
  }

  const mean = sum(lengths, length => length) / lengths.length;
  const variance = sum(lengths, length => (length - mean) ** 2) / lengths.length;

  return Math.sqrt(variance);
}

function compactness(planes: readonly MetricPlane[]): number {
  let occupiedArea = 0;
  let boundingArea = 0;

  for (const plane of planes) {
    const shapes = qualityShapes(plane.shapes);

    if (!shapes.length) {
      continue;
    }

    const points = shapes.flatMap(shape => [
      { x: shape.x, y: shape.y },
      { x: shape.x + shape.width, y: shape.y + shape.height }
    ]);

    for (const edge of plane.edges) {
      if (edge.isSequenceFlow) {
        points.push(...edge.waypoints);
      }
    }

    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);

    occupiedArea += sum(shapes, shape => shape.width * shape.height);
    boundingArea += width * height;
  }

  return boundingArea ? occupiedArea / boundingArea * SCORE_SCALE : 0;
}

function gridAlignment(planes: readonly MetricPlane[]): number {
  let aligned = 0;
  let total = 0;

  for (const plane of planes) {
    const shapes = qualityShapes(plane.shapes);

    total += shapes.length;
    aligned += shapes.filter(shape => {
      const shapeCenter = center(shape);

      return alignmentSize(shapes, candidate => center(candidate).x, shapeCenter.x) >= ALIGNMENT_SIZE ||
        alignmentSize(shapes, candidate => center(candidate).y, shapeCenter.y) >= ALIGNMENT_SIZE;
    }).length;
  }

  return total ? aligned / total * SCORE_SCALE : 0;
}

function branchSymmetry(planes: readonly MetricPlane[]): number {
  let symmetricTargets = 0;
  let totalTargets = 0;

  for (const plane of planes) {
    const shapeById = new Map<MetricId, MetricShape>(
      plane.shapes.map(shape => [ shape.id, shape ])
    );
    const outgoing = new Map<MetricId, MetricEdge[]>();

    for (const edge of plane.edges) {
      if (!edge.isSequenceFlow) {
        continue;
      }

      const edges = outgoing.get(edge.sourceId) || [];
      edges.push(edge);
      outgoing.set(edge.sourceId, edges);
    }

    for (const [ sourceId, edges ] of outgoing) {
      const source = shapeById.get(sourceId);

      if (!source?.isGateway || edges.length < 2 || edges.some(edge => edge.isDefault)) {
        continue;
      }

      const targets: MetricShape[] = [];

      for (const edge of edges) {
        const target = shapeById.get(edge.targetId);

        if (target) {
          targets.push(target);
        }
      }
      const sourceCenter = center(source);

      totalTargets += targets.length;
      symmetricTargets += targets.filter(target => {
        const targetCenter = center(target);
        const reflectedY = 2 * sourceCenter.y - targetCenter.y;

        return targets.some(candidate => {
          const candidateCenter = center(candidate);

          return closePosition(candidateCenter.x, targetCenter.x) &&
            closePosition(candidateCenter.y, reflectedY);
        });
      }).length;
    }
  }

  return totalTargets ? symmetricTargets / totalTargets * SCORE_SCALE : SCORE_SCALE;
}

function qualityShapes(
    shapes: readonly MetricShape[]
): MetricShape[] {
  return shapes.filter(shape => shape.isFlowNode && !shape.isBoundary);
}

function alignmentSize(
    items: readonly MetricShape[],
    coordinate: (item: MetricShape) => number,
    value: number
): number {
  return items.filter(item => closePosition(coordinate(item), value)).length;
}

function closePosition(a: number, b: number): boolean {
  return Math.abs(a - b) <= POSITION_TOLERANCE;
}

function center(shape: MetricShape): MetricWaypoint {
  return {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2
  };
}

function roundScore(value: number): number {
  const factor = 10 ** SCORE_PRECISION;

  return Math.round(value * factor) / factor;
}
