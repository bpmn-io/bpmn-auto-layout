import { OUTER_MARGIN } from '../Constants.js';
import { isExteriorArtifact } from '../bpmn/Predicates.js';
import { getShapeExtents } from './Geometry.js';

import type {
  BpmnElement,
  Bounds,
  LayoutRecord,
  LayoutState,
  Waypoint
} from '../Types.js';
import type { Extents } from './Geometry.js';

export function createLayout(scope: BpmnElement): LayoutState {
  return {
    scope,
    shapes: new Map(),
    edges: new Map(),
    children: [],
    emitInParent: false
  };
}

export function normalizeLayout(layout: LayoutState): void {
  const extents = getShapeExtents([
    ...layout.shapes.entries(),
    ...getExpandedChildShapes(layout)
  ].map(([ element, rect ]) => ({ element, rect })));

  translateLayout(
    layout,
    OUTER_MARGIN - extents.minX,
    OUTER_MARGIN - extents.minY
  );
}

export function translateLayout(
    layout: LayoutState,
    dx: number,
    dy: number
): void {
  for (const rect of layout.shapes.values()) {
    rect.x += dx;
    rect.y += dy;
  }

  for (const points of layout.edges.values()) {
    for (const routePoint of points) {
      routePoint.x += dx;
      routePoint.y += dy;
    }
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      translateLayout(child, dx, dy);
    }
  }
}

export function getExtents(layout: LayoutState): Extents {
  return getShapeExtents(
    [ ...layout.shapes.entries() ].map(([ element, rect ]) => ({
      element,
      rect
    }))
  );
}

export function getParticipantContentExtents(layout: LayoutState): Extents {
  return getShapeExtents(
    [ ...layout.shapes.entries() ]
      .filter(([ element ]) => !isExteriorArtifact(element))
      .map(([ element, rect ]) => ({ element, rect }))
  );
}

export function hasParticipantContent(layout: LayoutState): boolean {
  return [ ...layout.shapes.keys() ].some(element => {
    return !isExteriorArtifact(element);
  });
}

export function getRecordExtents(
    records: Array<LayoutRecord & { bounds: Bounds }>
): Extents {
  return getShapeExtents(records.map(record => ({ rect: record.bounds })));
}

export function getExpandedChildShapes(
    layout: LayoutState
): Array<[ BpmnElement, Bounds ]> {
  const shapes: Array<[ BpmnElement, Bounds ]> = [];

  for (const child of layout.children) {
    if (!child.emitInParent) {
      continue;
    }

    shapes.push(...child.shapes.entries());
    shapes.push(...getExpandedChildShapes(child));
  }

  return shapes;
}

export function getExpandedChildEdges(
    layout: LayoutState
): Array<[ BpmnElement, Waypoint[] ]> {
  const edges: Array<[ BpmnElement, Waypoint[] ]> = [];

  for (const child of layout.children) {
    if (!child.emitInParent) {
      continue;
    }

    edges.push(...child.edges.entries());
    edges.push(...getExpandedChildEdges(child));
  }

  return edges;
}
