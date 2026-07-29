import { DiFactory } from '../di/DiFactory.js';
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
  const factory = new DiFactory(moddle);
  return preparedPlanes.map(plane => emitDiagram(factory, plane));
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

function emitDiagram(factory, { layout, labels }) {
  const plane = factory.createDiPlane({
    id: `BPMNPlane_${layout.scope.id}`,
    bpmnElement: layout.scope,
    planeElement: []
  });
  const diagram = factory.createDiDiagram({
    id: `BPMNDiagram_${layout.scope.id}`,
    plane
  });

  emitLayout(factory, layout, labels, plane.planeElement);

  return diagram;
}

function emitLayout(factory, layout, labels, planeElements) {
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
      attrs.label = factory.createDiLabel(integerBounds(labelBounds));
    }

    planeElements.push(factory.createDiShape(element, integerBounds(rect), {
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
      attrs.label = factory.createDiLabel(integerBounds(labelBounds));
    }

    planeElements.push(factory.createDiEdge(element, points, attrs));
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      emitLayout(factory, child, labels, planeElements);
    }
  }
}
