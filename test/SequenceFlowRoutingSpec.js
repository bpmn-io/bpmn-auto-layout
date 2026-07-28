import assert from 'node:assert';

import {
  routeConnection
} from '../lib/layout/process/routing/SequenceFlowRouting.js';

describe('SequenceFlowRouting', function() {

  it('should route direct connections before trying fallbacks', function() {
    const source = element('Source');
    const target = element('Target');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 0, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 200, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [],
      policy(flow, source, target)
    ), [
      { x: 100, y: 40 },
      { x: 200, y: 40 }
    ]);
  });

  it('should prefer an orthogonal cross-band join', function() {
    const source = element('Source');
    const target = element('Target');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 0, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 200, y: 160, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [],
      policy(flow, source, target)
    ), [
      { x: 100, y: 40 },
      { x: 250, y: 40 },
      { x: 250, y: 160 }
    ]);
  });

});

function element(id) {
  return {
    id,
    outgoing: [],
    $instanceOf() {
      return false;
    }
  };
}

function sequenceFlow(sourceRef, targetRef) {
  const flow = {
    id: 'Flow',
    sourceRef,
    targetRef
  };

  sourceRef.outgoing.push(flow);
  return flow;
}

function shapes(source, sourceBounds, target, targetBounds) {
  return [
    { element: source, rect: sourceBounds },
    { element: target, rect: targetBounds }
  ];
}

function policy(flow, source, target) {
  return {
    backEdges: new Set(),
    bands: new Map([
      [ source, 0 ],
      [ target, 0 ]
    ]),
    straightEdges: new Set([ flow ]),
    spine: new Set(),
    graphEdges: [ flow ]
  };
}
