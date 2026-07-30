import { is } from '../di/DiUtil.js';
import { finalizeLayoutConnections } from './connections/FinalizeConnections.js';
import {
  integerBounds,
  normalizeLayout
} from './geometry/index.js';
import { layoutExternalLabels } from './labels/LayoutLabels.js';

import type {
  BpmnDiModdleElementAttributes,
  BpmnDiModdleElementFor,
  BpmnDiModdleFactory,
  BpmnDiModdleTypeName
} from './bpmn/Types.js';
import type {
  BpmnElement,
  Bounds,
  LayoutState,
  Waypoint
} from './Types.js';

type BpmnDiagram = BpmnDiModdleElementFor<'bpmndi:BPMNDiagram'>;
type BpmnEdge = BpmnDiModdleElementFor<'bpmndi:BPMNEdge'>;
type BpmnLabel = BpmnDiModdleElementFor<'bpmndi:BPMNLabel'>;
type BpmnPlane = BpmnDiModdleElementFor<'bpmndi:BPMNPlane'>;
type BpmnShape = BpmnDiModdleElementFor<'bpmndi:BPMNShape'>;
type BoundsElement = BpmnDiModdleElementFor<'dc:Bounds'>;
type PointElement = BpmnDiModdleElementFor<'dc:Point'>;

type PlaneElement = BpmnShape | BpmnEdge;

type PreparedPlane = {
  layout: LayoutState;
  labels: Map<BpmnElement, Bounds>;
};

type ShapeAttributes = Pick<
  BpmnDiModdleElementAttributes<'bpmndi:BPMNShape'>,
  'id' | 'isExpanded' | 'isHorizontal' | 'isMarkerVisible' | 'label'
>;

type EdgeAttributes = Pick<
  BpmnDiModdleElementAttributes<'bpmndi:BPMNEdge'>,
  'id' | 'label'
>;

export function generateDiagrams(
    moddle: BpmnDiModdleFactory,
    layout: LayoutState
): BpmnDiagram[] {
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

function collectPlaneLayouts(layout: LayoutState): LayoutState[] {
  const planes = [ layout ];

  collectCollapsedLayouts(layout, planes);

  return planes;
}

function collectCollapsedLayouts(
    layout: LayoutState,
    planes: LayoutState[]
): void {
  for (const child of layout.children) {
    if (!child.emitInParent) {
      planes.push(child);
    }

    collectCollapsedLayouts(child, planes);
  }
}

function emitDiagram(
    moddle: BpmnDiModdleFactory,
    { layout, labels }: PreparedPlane
): BpmnDiagram {
  const planeElements: PlaneElement[] = [];
  const plane: BpmnPlane = createElement(moddle, 'bpmndi:BPMNPlane', {
    id: `BPMNPlane_${layout.scope.id}`,
    bpmnElement: layout.scope,
    planeElement: planeElements
  });
  const diagram = createElement(moddle, 'bpmndi:BPMNDiagram', {
    id: `BPMNDiagram_${layout.scope.id}`,
    plane
  });

  emitLayout(moddle, layout, labels, planeElements);

  return diagram;
}

function emitLayout(
    moddle: BpmnDiModdleFactory,
    layout: LayoutState,
    labels: Map<BpmnElement, Bounds>,
    planeElements: PlaneElement[]
): void {
  for (const [ element, rect ] of layout.shapes) {
    const attrs: ShapeAttributes = {};
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
    const attrs: EdgeAttributes = {
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

function createShape(
    moddle: BpmnDiModdleFactory,
    semantic: BpmnElement,
    shapeBounds: Bounds,
    attrs: ShapeAttributes
): BpmnShape {
  return createElement(moddle, 'bpmndi:BPMNShape', {
    bpmnElement: semantic,
    bounds: createBounds(moddle, shapeBounds),
    ...attrs
  });
}

function createEdge(
    moddle: BpmnDiModdleFactory,
    semantic: BpmnElement,
    waypoints: Waypoint[],
    attrs: EdgeAttributes
): BpmnEdge {
  return createElement(moddle, 'bpmndi:BPMNEdge', {
    bpmnElement: semantic,
    waypoint: waypoints.map(point => {
      return createPoint(moddle, point);
    }),
    ...attrs
  });
}

function createLabel(
    moddle: BpmnDiModdleFactory,
    labelBounds: Bounds
): BpmnLabel {
  return createElement(moddle, 'bpmndi:BPMNLabel', {
    bounds: createBounds(moddle, labelBounds)
  });
}

function createBounds(
    moddle: BpmnDiModdleFactory,
    rect: Bounds
): BoundsElement {
  return createElement(moddle, 'dc:Bounds', rect);
}

function createPoint(
    moddle: BpmnDiModdleFactory,
    point: Waypoint
): PointElement {
  return createElement(moddle, 'dc:Point', {
    x: point.x,
    y: point.y
  });
}

function createElement<Type extends BpmnDiModdleTypeName>(
    moddle: BpmnDiModdleFactory,
    type: Type,
    attrs: BpmnDiModdleElementAttributes<Type>
): BpmnDiModdleElementFor<Type> {
  return moddle.create(type, attrs);
}
