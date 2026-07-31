import assert from 'node:assert';
import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  finalizeLayoutConnections
} from '../lib/layout/connections/FinalizeConnections.js';

import type { LayoutState } from '../lib/layout/Types.js';

describe('FinalizeConnections', function() {

  it('should center a clear orthogonal sequence-flow elbow', function() {
    const moddle = new BpmnModdle();
    const scope = moddle.create('bpmn:Process', { id: 'Process' });
    const source = moddle.create('bpmn:Task', { id: 'Source' });
    const target = moddle.create('bpmn:Task', { id: 'Target' });
    const flow = moddle.create('bpmn:SequenceFlow', {
      id: 'Flow',
      sourceRef: source,
      targetRef: target
    });
    const layout: LayoutState = {
      scope,
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
      children: [],
      emitInParent: false
    };

    finalizeLayoutConnections(layout);

    assert.deepStrictEqual(layout.edges.get(flow), [
      { x: 50, y: 80 },
      { x: 50, y: 200 },
      { x: 200, y: 200 }
    ]);
  });
});
