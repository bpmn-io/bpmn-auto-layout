import assert from 'node:assert';

import { emitLayout } from '../lib/di/LayoutEmitter.js';

describe('LayoutEmitter', function() {

  it('should serialize finalized connection geometry unchanged', function() {
    const flow = { id: 'Flow_1' };
    const points = [ { x: 10, y: 20 }, { x: 30, y: 40 } ];
    const layout = {
      shapes: new Map(),
      edges: new Map([ [ flow, points ] ]),
      children: []
    };
    const planeElements = [];
    const factory = {
      createDiEdge(element, waypoints, attrs) {
        return { element, waypoints, attrs };
      }
    };

    emitLayout(factory, layout, planeElements);

    assert.strictEqual(planeElements[0].waypoints, points);
    assert.strictEqual(layout.edges.get(flow), points);
    assert.deepStrictEqual(points, [
      { x: 10, y: 20 },
      { x: 30, y: 40 }
    ]);
  });
});
