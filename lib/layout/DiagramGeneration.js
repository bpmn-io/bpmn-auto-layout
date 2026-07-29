import { is } from '../di/DiUtil.js';
import { finalizeLayoutConnections } from './connections/FinalizeConnections.js';
import {
  integerBounds,
  normalizeLayout
} from './geometry/index.js';
import { layoutExternalLabels } from './labels/LayoutLabels.js';

export function generateDiagrams(moddle, layout) {
  const preparedPlanes = collectPlaneLayouts(layout).map(planeLayout => {
    normalizeLayout(planeLayout);
    finalizeLayoutConnections(planeLayout, planeLayout === layout);

    return {
      layout: planeLayout,
      labels: layoutExternalLabels(planeLayout)
    };
  });
  return preparedPlanes.map(plane => emitDiagram(moddle, plane));
}

function collectPlaneLayouts(layout) {
  const planes = [ layout ];

  collectCollapsedLayouts(layout, planes);

  return planes;
}

function collectCollapsedLayouts(layout, planes) {
  for (const child of layout.children) {
    if (!child.emitInParent) {
      planes.push(child);
    }

    collectCollapsedLayouts(child, planes);
  }
}

function emitDiagram(moddle, { layout, labels }) {
  const plane = createElement(moddle, 'bpmndi:BPMNPlane', {
    id: `BPMNPlane_${layout.scope.id}`,
    bpmnElement: layout.scope,
    planeElement: []
  });
  const diagram = createElement(moddle, 'bpmndi:BPMNDiagram', {
    id: `BPMNDiagram_${layout.scope.id}`,
    plane
  });

  emitLayout(moddle, layout, labels, plane.planeElement);

  return diagram;
}

function emitLayout(moddle, layout, labels, planeElements) {
  for (const [ element, rect ] of layout.shapes) {
    const attrs = {};
    const labelBounds = labels.get(element);

    if (is(element, 'bpmn:SubProcess') && layout.children.some(child => {
      return child.scope === element && child.emitInParent;
    })) {
      attrs.isExpanded = true;
    }

    if (is(element, 'bpmn:Participant') || is(element, 'bpmn:Lane')) {
      attrs.isHorizontal = true;
    }

    if (is(element, 'bpmn:Gateway')) {
      attrs.isMarkerVisible = true;
    }

    if (labelBounds) {
      attrs.label = createLabel(moddle, integerBounds(labelBounds));
    }

    planeElements.push(createShape(moddle, element, integerBounds(rect), {
      id: `BPMNShape_${element.id}`,
      ...attrs
    }));
  }

  for (const [ element, points ] of layout.edges) {
    const attrs = {
      id: `BPMNEdge_${element.id}`
    };
    const labelBounds = labels.get(element);

    if (labelBounds) {
      attrs.label = createLabel(moddle, integerBounds(labelBounds));
    }

    planeElements.push(createEdge(moddle, element, points, attrs));
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      emitLayout(moddle, child, labels, planeElements);
    }
  }
}

function createShape(moddle, semantic, shapeBounds, attrs) {
  return createElement(moddle, 'bpmndi:BPMNShape', {
    bpmnElement: semantic,
    bounds: createBounds(moddle, shapeBounds),
    ...attrs
  });
}

function createEdge(moddle, semantic, waypoints, attrs) {
  return createElement(moddle, 'bpmndi:BPMNEdge', {
    bpmnElement: semantic,
    waypoint: waypoints.map(point => {
      return createElement(moddle, 'dc:Point', {
        x: point.x,
        y: point.y
      });
    }),
    ...attrs
  });
}

function createLabel(moddle, labelBounds) {
  return createElement(moddle, 'bpmndi:BPMNLabel', {
    bounds: createBounds(moddle, labelBounds)
  });
}

function createBounds(moddle, rect) {
  return createElement(moddle, 'dc:Bounds', rect);
}

function createElement(moddle, type, attrs) {
  return moddle.create(type, attrs);
}
