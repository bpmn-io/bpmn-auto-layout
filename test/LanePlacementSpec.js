import assert from 'node:assert';

import {
  applyLaneMembership
} from '../lib/layout/process/placement/LanePlacement.js';

describe('LanePlacement', function() {

  it('should validate, measure, and position lane content', function() {
    const task = { id: 'Task' };
    const lane = {
      id: 'Lane',
      flowNodeRef: [ task ]
    };
    const record = {
      element: task,
      bounds: { x: 0, y: 0, width: 100, height: 80 }
    };
    const layout = { shapes: new Map() };

    applyLaneMembership(
      { laneSets: [ { lanes: [ lane ] } ] },
      [ record ],
      [],
      {
        backEdges: new Set(),
        straightEdges: new Set()
      },
      layout
    );

    assert.deepStrictEqual(layout.shapes.get(lane), {
      x: 0,
      y: 0,
      width: 380,
      height: 240
    });
    assert.deepStrictEqual(record.bounds, {
      x: 40,
      y: 80,
      width: 100,
      height: 80
    });
  });
});
