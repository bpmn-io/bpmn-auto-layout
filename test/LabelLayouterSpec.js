import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';

import { DiFactory } from '../lib/di/DiFactory.js';
import {
  externalLabelSize,
  layoutExternalLabels
} from '../lib/layout/LabelLayouter.js';
import { rectanglesOverlap } from '../lib/layout/LayoutUtil.js';

describe('LabelLayouter', function() {

  let moddle;
  let factory;

  beforeEach(function() {
    moddle = new BpmnModdle();
    factory = new DiFactory(moddle);
  });

  it('should use below, above, left, and right shape fallbacks', function() {
    const below = eventShape('Below', 100, 100);
    const above = eventShape('Above', 300, 100);
    const left = eventShape('Left', 500, 100);
    const right = eventShape('Right', 700, 100);
    const elements = [
      below,
      above,
      left,
      right,
      taskShape('BelowBlock', 250, 135, 140, 40),
      taskShape('LeftBelowBlock', 450, 135, 140, 40),
      taskShape('LeftAboveBlock', 450, 60, 140, 40),
      taskShape('RightBelowBlock', 650, 135, 140, 40),
      taskShape('RightAboveBlock', 650, 60, 140, 40),
      taskShape('RightLeftBlock', 595, 80, 100, 60)
    ];

    layoutExternalLabels(factory, elements);

    assert.deepStrictEqual(toBounds(below.label.bounds), {
      x: 73, y: 141, width: 90, height: 14
    });
    assert.deepStrictEqual(toBounds(above.label.bounds), {
      x: 273, y: 81, width: 90, height: 14
    });
    assert.deepStrictEqual(toBounds(left.label.bounds), {
      x: 405, y: 111, width: 90, height: 14
    });
    assert.deepStrictEqual(toBounds(right.label.bounds), {
      x: 741, y: 111, width: 90, height: 14
    });
  });

  it('should place connection labels beside their owning segment', function() {
    const horizontal = edge('Horizontal', [
      { x: 100, y: 100 },
      { x: 300, y: 100 }
    ]);
    const vertical = edge('Vertical', [
      { x: 500, y: 100 },
      { x: 500, y: 300 }
    ]);

    layoutExternalLabels(factory, [ horizontal, vertical ]);

    assert.deepStrictEqual(toBounds(horizontal.label.bounds), {
      x: 155, y: 78, width: 90, height: 14
    });
    assert.deepStrictEqual(toBounds(vertical.label.bounds), {
      x: 505, y: 193, width: 90, height: 14
    });
  });

  it('should move connection labels to the opposite side when blocked', function() {
    const horizontal = edge('Horizontal', [
      { x: 100, y: 100 },
      { x: 300, y: 100 }
    ]);
    const vertical = edge('Vertical', [
      { x: 500, y: 100 },
      { x: 500, y: 300 }
    ]);
    const elements = [
      horizontal,
      vertical,
      edge('HorizontalBlock', [
        { x: 100, y: 90 },
        { x: 300, y: 90 }
      ], false),
      edge('VerticalBlock', [
        { x: 550, y: 100 },
        { x: 550, y: 300 }
      ], false)
    ];

    layoutExternalLabels(factory, elements);

    assert.deepStrictEqual(toBounds(horizontal.label.bounds), {
      x: 155, y: 108, width: 90, height: 14
    });
    assert.deepStrictEqual(toBounds(vertical.label.bounds), {
      x: 405, y: 193, width: 90, height: 14
    });
  });

  it('should prefer connection segments that are not shared', function() {
    const sales = edge('sales', [
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 300, y: 200 }
    ]);
    const technical = edge('technical', [
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 300, y: 300 }
    ]);
    const legal = edge('legal', [
      { x: 100, y: 100 },
      { x: 100, y: 400 },
      { x: 300, y: 400 }
    ]);

    layoutExternalLabels(factory, [ sales, technical, legal ]);

    assert.deepStrictEqual(toBounds(sales.label.bounds), {
      x: 155, y: 178, width: 90, height: 14
    });
    assert.deepStrictEqual(toBounds(technical.label.bounds), {
      x: 155, y: 278, width: 90, height: 14
    });
    assert.deepStrictEqual(toBounds(legal.label.bounds), {
      x: 105, y: 343, width: 90, height: 14
    });
  });

  it('should reserve placed label bounds', function() {
    const first = edge('First', [
      { x: 100, y: 100 },
      { x: 300, y: 100 }
    ]);
    const second = edge('Second', [
      { x: 100, y: 100 },
      { x: 300, y: 100 }
    ]);

    layoutExternalLabels(factory, [ first, second ]);

    assert.ok(!rectanglesOverlap(first.label.bounds, second.label.bounds));
  });

  it('should freely move a shape label when owner-relative positions are blocked', function() {
    const event = eventShape('Event', 100, 100);
    const elements = [
      event,
      taskShape('Below', 73, 141, 90, 14),
      taskShape('Above', 73, 81, 90, 14),
      taskShape('Left', 5, 111, 90, 14),
      taskShape('Right', 141, 111, 90, 14)
    ];

    layoutExternalLabels(factory, elements);

    const label = toBounds(event.label.bounds);

    assert.notDeepStrictEqual(label, {
      x: 73, y: 141, width: 90, height: 14
    });
    assert.ok(elements.slice(1).every(shape => {
      return !rectanglesOverlap(label, shape.bounds);
    }));
  });

  it('should keep a clear visual corridor between a label and its owner', function() {
    const subprocess = expandedSubProcess('SubProcess', 0, 100, 400, 250);
    const event = eventShape('manual decision required', 180, 82);
    const blockingTask = taskShape('BlockingTask', 50, 140, 300, 80);
    const handler = edge('Handler', [
      { x: 198, y: 82 },
      { x: 198, y: 40 },
      { x: 350, y: 40 }
    ], false);

    layoutExternalLabels(factory, [
      subprocess,
      event,
      blockingTask,
      handler
    ]);

    const label = toBounds(event.label.bounds);

    assert.ok(label.y + label.height < subprocess.bounds.y);
  });

  it('should keep labels out of expanded subprocess title bands', function() {
    const subprocess = expandedSubProcess(
      'SubProcess',
      0,
      100,
      400,
      250,
      'Subprocess title'
    );
    const event = eventShape('Event', 180, 140);
    const below = taskShape('Below', 140, 176, 120, 40);

    layoutExternalLabels(factory, [ subprocess, event, below ]);

    const label = toBounds(event.label.bounds);
    const titleBand = { x: 0, y: 100, width: 400, height: 28 };

    assert.ok(!rectanglesOverlap(label, titleBand));
  });

  it('should keep space beside expanded subprocess titles available', function() {
    const subprocess = expandedSubProcess(
      'SubProcess',
      0,
      100,
      400,
      250,
      'Subprocess title'
    );
    const event = eventShape('Event', 50, 140);
    const below = taskShape('Below', 10, 176, 120, 40);

    layoutExternalLabels(factory, [ subprocess, event, below ]);

    assert.deepStrictEqual(toBounds(event.label.bounds), {
      x: 23, y: 121, width: 90, height: 14
    });
  });

  it('should reserve enough height for wide unbroken text', function() {
    assert.deepStrictEqual(externalLabelSize('WWWWWWWWWWWWWWW'), {
      width: 90,
      height: 28
    });
  });

  function eventShape(id, x, y) {
    const element = moddle.create('bpmn:IntermediateCatchEvent', {
      id,
      name: id
    });

    return factory.createDiShape(element, { x, y, width: 36, height: 36 });
  }

  function taskShape(id, x, y, width, height) {
    const element = moddle.create('bpmn:Task', { id });

    return factory.createDiShape(element, { x, y, width, height });
  }

  function expandedSubProcess(id, x, y, width, height, name) {
    const element = moddle.create('bpmn:SubProcess', { id, name });

    return factory.createDiShape(
      element,
      { x, y, width, height },
      { isExpanded: true }
    );
  }

  function edge(id, waypoints, named = true) {
    const element = moddle.create('bpmn:SequenceFlow', {
      id,
      name: named ? id : undefined
    });

    return factory.createDiEdge(element, waypoints);
  }
});

function toBounds({ x, y, width, height }) {
  return { x, y, width, height };
}
