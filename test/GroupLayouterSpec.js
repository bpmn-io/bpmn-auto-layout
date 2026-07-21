import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';

import { createLayout } from '../lib/layout/LayoutUtil.js';
import { layoutGroups } from '../lib/layout/GroupLayouter.js';

describe('GroupLayouter', function() {

  let moddle;
  let categoryValue;
  let process;

  beforeEach(function() {
    moddle = new BpmnModdle();
    categoryValue = moddle.create('bpmn:CategoryValue', {
      id: 'CategoryValue'
    });
    process = moddle.create('bpmn:Process', { id: 'Process' });
  });

  it('should include member shapes and connection waypoints', function() {
    const group = moddle.create('bpmn:Group', {
      id: 'Group',
      categoryValueRef: categoryValue
    });
    const task = moddle.create('bpmn:Task', {
      id: 'Task',
      categoryValueRef: [ categoryValue ]
    });
    const flow = moddle.create('bpmn:SequenceFlow', {
      id: 'Flow',
      categoryValueRef: [ categoryValue ]
    });
    const layout = createLayout(process);

    layout.shapes.set(task, {
      x: 100, y: 100, width: 100, height: 80
    });
    layout.edges.set(flow, [
      { x: 150, y: 140 },
      { x: 350, y: 140 }
    ]);

    const warnings = layoutGroups([ group ], layout);

    assert.deepStrictEqual(layout.shapes.get(group), {
      x: 60, y: 60, width: 330, height: 160
    });
    assert.deepStrictEqual(warnings, []);
  });

  it('should omit groups without visible members', function() {
    const group = moddle.create('bpmn:Group', {
      id: 'Group',
      categoryValueRef: categoryValue
    });
    const layout = createLayout(process);

    const warnings = layoutGroups([ group ], layout);

    assert.ok(!layout.shapes.has(group));
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'GROUP_MEMBERS_NOT_FOUND');
  });
});
