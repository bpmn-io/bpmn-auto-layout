import { OUTER_MARGIN } from '../Constants.js';
import { isExteriorArtifact } from '../bpmn/Predicates.js';
import { getShapeExtents } from './Geometry.js';

/**
 * @typedef {import('../Types.js').LayoutState} LayoutState
 */

/**
 * Create the empty state for one independently laid-out BPMN scope.
 *
 * @param {Object} scope
 * @returns {LayoutState}
 */
export function createLayout(scope) {
  return {
    scope,
    shapes: new Map(),
    edges: new Map(),
    children: [],
    emitInParent: false
  };
}

export function normalizeLayout(layout) {
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

export function translateLayout(layout, dx, dy) {
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

export function getExtents(layout) {
  return getShapeExtents(
    [ ...layout.shapes.entries() ].map(([ element, rect ]) => ({
      element,
      rect
    }))
  );
}

export function getParticipantContentExtents(layout) {
  return getShapeExtents(
    [ ...layout.shapes.entries() ]
      .filter(([ element ]) => !isExteriorArtifact(element))
      .map(([ element, rect ]) => ({ element, rect }))
  );
}

export function hasParticipantContent(layout) {
  return [ ...layout.shapes.keys() ].some(element => {
    return !isExteriorArtifact(element);
  });
}

export function getRecordExtents(records) {
  return getShapeExtents(records.map(record => ({ rect: record.bounds })));
}

export function getExpandedChildShapes(layout) {
  const shapes = [];

  for (const child of layout.children) {
    if (!child.emitInParent) {
      continue;
    }

    shapes.push(...child.shapes.entries());
    shapes.push(...getExpandedChildShapes(child));
  }

  return shapes;
}

export function getExpandedChildEdges(layout) {
  const edges = [];

  for (const child of layout.children) {
    if (!child.emitInParent) {
      continue;
    }

    edges.push(...child.edges.entries());
    edges.push(...getExpandedChildEdges(child));
  }

  return edges;
}
