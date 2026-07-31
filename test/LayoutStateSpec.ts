import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  createLayout,
  getExpandedChildEdges,
  getExpandedChildShapes
} from '../lib/layout/geometry/LayoutState.js';

const moddle = new BpmnModdle();

describe('LayoutState', function() {

  it('should create empty state for an independently laid-out scope', function() {
    const scope = moddle.create('bpmn:Process', { id: 'Process_1' });

    const layout = createLayout(scope);

    assert.strictEqual(layout.scope, scope);
    assert.deepStrictEqual(layout.shapes, new Map());
    assert.deepStrictEqual(layout.edges, new Map());
    assert.deepStrictEqual(layout.children, []);
    assert.strictEqual(layout.emitInParent, false);
  });


  it('should expose only geometry emitted in the parent plane', function() {
    const expandedShape = moddle.create('bpmn:Task', { id: 'Task_expanded' });
    const collapsedShape = moddle.create('bpmn:Task', { id: 'Task_collapsed' });
    const nestedShape = moddle.create('bpmn:Task', { id: 'Task_nested' });
    const expandedEdge = moddle.create('bpmn:SequenceFlow', { id: 'Flow_expanded' });
    const collapsedEdge = moddle.create('bpmn:SequenceFlow', { id: 'Flow_collapsed' });
    const nestedEdge = moddle.create('bpmn:SequenceFlow', { id: 'Flow_nested' });
    const layout = createLayout(moddle.create('bpmn:Process', { id: 'Process_1' }));
    const expandedChild = createLayout(moddle.create('bpmn:SubProcess', { id: 'SubProcess_expanded' }));
    const collapsedChild = createLayout(moddle.create('bpmn:SubProcess', { id: 'SubProcess_collapsed' }));
    const nestedChild = createLayout(moddle.create('bpmn:SubProcess', { id: 'SubProcess_nested' }));

    expandedChild.emitInParent = true;
    expandedChild.shapes.set(expandedShape, { x: 0, y: 0, width: 100, height: 80 });
    expandedChild.edges.set(expandedEdge, [ { x: 0, y: 40 }, { x: 100, y: 40 } ]);
    collapsedChild.shapes.set(collapsedShape, { x: 0, y: 0, width: 100, height: 80 });
    collapsedChild.edges.set(collapsedEdge, [ { x: 0, y: 40 }, { x: 100, y: 40 } ]);
    nestedChild.emitInParent = true;
    nestedChild.shapes.set(nestedShape, { x: 120, y: 0, width: 100, height: 80 });
    nestedChild.edges.set(nestedEdge, [ { x: 120, y: 40 }, { x: 220, y: 40 } ]);
    expandedChild.children.push(nestedChild);
    layout.children.push(expandedChild, collapsedChild);

    assert.deepStrictEqual(getExpandedChildShapes(layout), [
      [ expandedShape, { x: 0, y: 0, width: 100, height: 80 } ],
      [ nestedShape, { x: 120, y: 0, width: 100, height: 80 } ]
    ]);
    assert.deepStrictEqual(getExpandedChildEdges(layout), [
      [ expandedEdge, [ { x: 0, y: 40 }, { x: 100, y: 40 } ] ],
      [ nestedEdge, [ { x: 120, y: 40 }, { x: 220, y: 40 } ] ]
    ]);
  });
});
