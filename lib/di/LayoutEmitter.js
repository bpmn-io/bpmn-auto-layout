import { is } from './DiUtil.js';
import { integerBounds } from '../layout/LayoutUtil.js';

export function emitLayout(factory, layout, planeElements) {
  for (const [ element, rect ] of layout.shapes) {
    const attrs = {};

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

    planeElements.push(factory.createDiShape(element, integerBounds(rect), {
      id: `BPMNShape_${element.id}`,
      ...attrs
    }));
  }

  for (const [ element, points ] of layout.edges) {
    planeElements.push(factory.createDiEdge(element, points, {
      id: `BPMNEdge_${element.id}`
    }));
  }

  for (const child of layout.children) {
    if (child.emitInParent) {
      emitLayout(factory, child, planeElements);
    }
  }
}
