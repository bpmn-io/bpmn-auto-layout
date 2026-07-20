import { BpmnModdle } from 'bpmn-moddle';

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
 * - `wrongWayDockings`       — edge endpoints whose dock is not on its shape
 *                              perimeter or whose adjacent segment enters the
 *                              endpoint shape.
 *
 * Band-C (polish — informational) numbers:
 *
 * - `crossings`                   — edge-segment pairs that properly cross.
 * - `bendCount`                   — direction changes in edge waypoint paths.
 * - `edgeLength`                  — total edge waypoint-polyline length.
 * - `edgeSegmentLengthDeviation`  — standard deviation of segment lengths.
 * - `labelShapeOverlaps`          — external labels that overlap flow-node
 *                                   shapes.
 * - `compactness`                 — flow-node area as a percentage of the
 *                                   flow-node and sequence-flow bounding box.
 * - `gridAlignment`               — percentage of flow nodes participating in
 *                                   a horizontal or vertical alignment of at
 *                                   least three nodes.
 * - `branchSymmetry`              — percentage of targets in non-default
 *                                   gateway fans that reflect across the
 *                                   gateway's horizontal axis.
 *
 * @param {string} xml laid-out BPMN 2.0 XML
 * @return {Promise<{
 *   shapeCount: number,
 *   edgeCount: number,
 *   crossings: number,
 *   overlaps: number,
 *   edgeShapeIntersections: number,
 *   wrongWayDockings: number,
 *   bendCount: number,
 *   edgeLength: number,
 *   edgeSegmentLengthDeviation: number,
 *   labelShapeOverlaps: number,
 *   compactness: number,
 *   gridAlignment: number,
 *   branchSymmetry: number
 * }>}
 */
export async function computeMetrics(xml) {
  const { rootElement: definitions } = await moddle.fromXML(xml);

  const planes = [];

  for (const diagram of definitions.diagrams || []) {
    const plane = diagram.plane;

    if (!plane) {
      continue;
    }

    const shapes = [];
    const edges = [];

    for (const di of plane.planeElement || []) {
      if (di.$instanceOf('bpmndi:BPMNShape') && di.bounds) {
        shapes.push(toShape(di));
      } else if (di.$instanceOf('bpmndi:BPMNEdge') && di.waypoint) {
        edges.push(toEdge(di));
      }
    }

    planes.push({ shapes, edges });
  }

  return {
    shapeCount: sum(planes, plane => plane.shapes.length),
    edgeCount: sum(planes, plane => plane.edges.length),
    crossings: sum(planes, plane => countCrossings(plane.edges)),
    overlaps: sum(planes, plane => countOverlaps(plane.shapes)),
    edgeShapeIntersections: sum(planes, plane => countEdgeShapeIntersections(plane.edges, plane.shapes)),
    wrongWayDockings: sum(planes, plane => countWrongWayDockings(plane.edges, plane.shapes)),
    bendCount: sum(planes, plane => countBends(plane.edges)),
    edgeLength: Math.round(sum(planes, plane => totalEdgeLength(plane.edges))),
    edgeSegmentLengthDeviation: roundScore(segmentLengthDeviation(planes)),
    labelShapeOverlaps: sum(planes, plane => countLabelShapeOverlaps(plane.shapes, plane.edges)),
    compactness: roundScore(compactness(planes)),
    gridAlignment: roundScore(gridAlignment(planes)),
    branchSymmetry: roundScore(branchSymmetry(planes))
  };
}

function sum(items, mapper) {
  return items.reduce((total, item) => total + mapper(item), 0);
}


// shape extraction ////////////////////////////////////////////////

function toShape(di) {
  const element = di.bpmnElement;
  const { x, y, width, height } = di.bounds;

  return {
    id: element && element.id,
    x, y, width, height,
    isFlowNode: !!element && element.$instanceOf('bpmn:FlowNode'),
    isGateway: !!element && element.$instanceOf('bpmn:Gateway'),
    labelBounds: toLabelBounds(di.label),
    isBoundary: !!element && element.$instanceOf('bpmn:BoundaryEvent'),
    isArtifact: !!element && (
      element.$instanceOf('bpmn:TextAnnotation') ||
      element.$instanceOf('bpmn:DataObjectReference') ||
      element.$instanceOf('bpmn:DataStoreReference')
    ),
    isContainer:
      di.isExpanded === true ||
      (!!element && (
        element.$instanceOf('bpmn:Participant') ||
        element.$instanceOf('bpmn:Lane')
      ))
  };
}

function toEdge(di) {
  const element = di.bpmnElement;
  const source = element && element.sourceRef;
  const target = element && element.targetRef;

  return {
    id: element && element.id,
    sourceId: source && source.id,
    targetId: target && target.id,
    isSequenceFlow: !!element && element.$instanceOf('bpmn:SequenceFlow'),
    hasLabel: typeof element?.name === 'string' && element.name.trim().length > 0,
    name: element && element.name,
    isDefault: !!source && source.default === element,
    labelBounds: toLabelBounds(di.label),
    waypoints: di.waypoint.map(({ x, y }) => ({ x, y }))
  };
}

function toLabelBounds(label) {
  if (!label?.bounds) {
    return null;
  }

  const { x, y, width, height } = label.bounds;

  return { x, y, width, height };
}


// node overlaps ///////////////////////////////////////////////////

function countOverlaps(shapes) {
  let count = 0;

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

      count++;
    }
  }

  return count;
}

function rectanglesOverlap(a, b) {
  return a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
}

function contains(outer, inner) {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}


// edge crossings //////////////////////////////////////////////////

function countCrossings(edges) {
  const segments = edges.map(edge => toSegments(edge.waypoints));

  let count = 0;

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      for (const s of segments[i]) {
        for (const t of segments[j]) {
          if (segmentsProperlyCross(s[0], s[1], t[0], t[1])) {
            count++;
          }
        }
      }
    }
  }

  return count;
}

function toSegments(waypoints) {
  const segments = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    segments.push([ waypoints[i], waypoints[i + 1] ]);
  }

  return segments;
}

/**
 * Proper crossing: the segment interiors intersect. Shared endpoints (edges
 * meeting at a node), T-touches and collinear overlaps are NOT counted.
 */
function segmentsProperlyCross(p1, p2, p3, p4) {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function direction(a, b, c) {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
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
function countEdgeShapeIntersections(edges, shapes) {
  let count = 0;

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
        count++;
      }
    }
  }

  return count;
}

function inset(shape, margin) {
  return {
    x: shape.x + margin,
    y: shape.y + margin,
    width: shape.width - 2 * margin,
    height: shape.height - 2 * margin
  };
}

function edgeEntersRect(waypoints, rect) {
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
function segmentEntersRect(p1, p2, rect) {
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

function countWrongWayDockings(edges, shapes) {
  const shapeById = new Map(shapes.map(shape => [ shape.id, shape ]));
  let count = 0;

  for (const edge of edges) {
    if (edge.waypoints.length < 2) {
      count++;
      continue;
    }

    const source = shapeById.get(edge.sourceId);
    const target = shapeById.get(edge.targetId);

    if (source && !source.isArtifact &&
        dockingIsWrong(edge.waypoints[0], edge.waypoints[1], source)) {
      count++;
    }

    if (target && !target.isArtifact && dockingIsWrong(
      edge.waypoints.at(-1),
      edge.waypoints.at(-2),
      target
    )) {
      count++;
    }
  }

  return count;
}

function dockingIsWrong(endpoint, adjacent, shape) {
  return !dockingSides(endpoint, shape).some(side => {
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
  });
}

function dockingSides(point, shape) {
  const sides = [];

  if (between(point.x, shape.x, shape.x + shape.width)) {
    if (near(point.y, shape.y)) {
      sides.push('top');
    }
    if (near(point.y, shape.y + shape.height)) {
      sides.push('bottom');
    }
  }
  if (between(point.y, shape.y, shape.y + shape.height)) {
    if (near(point.x, shape.x)) {
      sides.push('left');
    }
    if (near(point.x, shape.x + shape.width)) {
      sides.push('right');
    }
  }

  return sides;
}

function between(value, min, max) {
  return value >= min - DOCKING_TOLERANCE && value <= max + DOCKING_TOLERANCE;
}

function near(a, b) {
  return Math.abs(a - b) <= DOCKING_TOLERANCE;
}


// edge length /////////////////////////////////////////////////////

function totalEdgeLength(edges) {
  let total = 0;

  for (const { waypoints } of edges) {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];

      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  return total;
}


// label/shape overlaps /////////////////////////////////////////////

const FLOW_LABEL_INDENT = 15;
const FLOW_LABEL_MAX_WIDTH = 90;
const FLOW_LABEL_HEIGHT = 14;
const FLOW_LABEL_CHARACTER_WIDTH = 6;

function countLabelShapeOverlaps(shapes, edges) {
  const labels = [
    ...shapes.map(shape => shape.labelBounds).filter(Boolean),
    ...edges.flatMap(edge => {
      const bounds = edge.labelBounds || implicitFlowLabelBounds(edge);

      return bounds ? [ bounds ] : [];
    })
  ];
  const obstacles = shapes.filter(shape => {
    return shape.isFlowNode && !shape.isBoundary && !shape.isArtifact;
  });

  let count = 0;

  for (const label of labels) {
    for (const shape of obstacles) {
      if (rectanglesOverlap(label, shape)) {
        count++;
      }
    }
  }

  return count;
}

function implicitFlowLabelBounds(edge) {
  if (!edge.hasLabel || !edge.waypoints.length) {
    return null;
  }

  const position = flowLabelPosition(edge.waypoints);
  const { width, height } = estimateFlowLabelSize(edge.name);

  return {
    x: position.x - width / 2,
    y: position.y - height / 2,
    width,
    height
  };
}

function flowLabelPosition(waypoints) {
  const mid = waypoints.length / 2 - 1;
  const first = waypoints[Math.floor(mid)];
  const second = waypoints[Math.ceil(mid + 0.01)];
  const x = first.x + (second.x - first.x) / 2;
  const y = first.y + (second.y - first.y) / 2;

  return Math.abs(second.y - first.y) <= Math.abs(second.x - first.x)
    ? { x, y: y - FLOW_LABEL_INDENT }
    : { x: x + FLOW_LABEL_INDENT, y };
}

function estimateFlowLabelSize(text) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (line && candidate.length * FLOW_LABEL_CHARACTER_WIDTH > FLOW_LABEL_MAX_WIDTH) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return {
    width: Math.min(
      FLOW_LABEL_MAX_WIDTH,
      Math.max(...lines.map(line => line.length * FLOW_LABEL_CHARACTER_WIDTH))
    ),
    height: lines.length * FLOW_LABEL_HEIGHT
  };
}


// polish metrics ///////////////////////////////////////////////////

const ALIGNMENT_SIZE = 3;
const POSITION_TOLERANCE = 1;
const SCORE_SCALE = 100;
const SCORE_PRECISION = 1;

function countBends(edges) {
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

function changesDirection(a, b, c) {
  const incoming = { x: b.x - a.x, y: b.y - a.y };
  const outgoing = { x: c.x - b.x, y: c.y - b.y };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;

  return cross !== 0 || dot < 0;
}

function removeConsecutiveDuplicates(points) {
  return points.filter((point, index) => {
    return index === 0 ||
      point.x !== points[index - 1].x ||
      point.y !== points[index - 1].y;
  });
}

function segmentLengthDeviation(planes) {
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

function compactness(planes) {
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

function gridAlignment(planes) {
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

function branchSymmetry(planes) {
  let symmetricTargets = 0;
  let totalTargets = 0;

  for (const plane of planes) {
    const shapeById = new Map(plane.shapes.map(shape => [ shape.id, shape ]));
    const outgoing = new Map();

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

      const targets = edges
        .map(edge => shapeById.get(edge.targetId))
        .filter(Boolean);
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

function qualityShapes(shapes) {
  return shapes.filter(shape => shape.isFlowNode && !shape.isBoundary);
}

function alignmentSize(items, coordinate, value) {
  return items.filter(item => closePosition(coordinate(item), value)).length;
}

function closePosition(a, b) {
  return Math.abs(a - b) <= POSITION_TOLERANCE;
}

function center(shape) {
  return {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2
  };
}

function roundScore(value) {
  const factor = 10 ** SCORE_PRECISION;

  return Math.round(value * factor) / factor;
}
