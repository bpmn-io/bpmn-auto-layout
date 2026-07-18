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
 * - `crossings`  — number of edge-segment pairs that properly cross.
 * - `edgeLength` — total length of all edge waypoint polylines (rounded).
 *
 * @param {string} xml laid-out BPMN 2.0 XML
 * @return {Promise<{
 *   shapeCount: number,
 *   edgeCount: number,
 *   crossings: number,
 *   overlaps: number,
 *   edgeShapeIntersections: number,
 *   wrongWayDockings: number,
 *   edgeLength: number
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
    edgeLength: Math.round(sum(planes, plane => totalEdgeLength(plane.edges)))
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
    waypoints: di.waypoint.map(({ x, y }) => ({ x, y }))
  };
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
