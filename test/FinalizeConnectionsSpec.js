import assert from 'node:assert';

import {
  finalizeLayoutConnections
} from '../lib/layout/connections/FinalizeConnections.js';

describe('FinalizeConnections', function() {

  it('should center a clear orthogonal sequence-flow elbow', function() {
    const source = element('Source', 'bpmn:Task');
    const target = element('Target', 'bpmn:Task');
    const flow = {
      id: 'Flow',
      sourceRef: source,
      targetRef: target,
      $instanceOf(type) {
        return type === 'bpmn:SequenceFlow';
      }
    };
    const layout = {
      shapes: new Map([
        [ source, { x: 0, y: 0, width: 100, height: 80 } ],
        [ target, { x: 200, y: 160, width: 100, height: 80 } ]
      ]),
      edges: new Map([
        [ flow, [
          { x: 100, y: 40 },
          { x: 100, y: 200 },
          { x: 200, y: 200 }
        ] ]
      ]),
      children: []
    };

    finalizeLayoutConnections(layout);

    assert.deepStrictEqual(layout.edges.get(flow), [
      { x: 50, y: 80 },
      { x: 50, y: 200 },
      { x: 200, y: 200 }
    ]);
  });
});

function element(id, type) {
  return {
    id,
    $instanceOf(candidate) {
      return candidate === type;
    }
  };
}
