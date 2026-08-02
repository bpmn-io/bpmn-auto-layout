import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  routeConnection
} from '../lib/layout/process/routing/SequenceFlowRouting.js';
import { LayoutError } from '../lib/LayoutError.js';

import type { BpmnElementFor } from '../lib/layout/bpmn/Types.js';

const moddle = new BpmnModdle();

type Connection = Parameters<typeof routeConnection>[0];
type RouterShape = Parameters<typeof routeConnection>[3][number];
type RoutingPolicy = Parameters<typeof routeConnection>[5];

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

  it('should exit an exposed feedback source toward the outer channel', function() {
    const source = element('Source');
    const target = element('Target');
    const lower = element('Lower');
    const upper = element('Upper');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 200, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      [
        ...shapes(source, sourceBounds, target, targetBounds),
        { element: lower, rect: { x: 100, y: 160, width: 100, height: 80 } },
        { element: upper, rect: { x: 100, y: -160, width: 100, height: 80 } }
      ],
      [],
      {
        ...policy(flow, source, target),
        backEdges: new Set([ flow ]),
        compactFeedbackNodes: new Set([ source ])
      }
    ), [
      { x: 300, y: 40 },
      { x: 320, y: 40 },
      { x: 320, y: 260 },
      { x: 50, y: 260 },
      { x: 50, y: 80 }
    ]);
  });

  it('should directly route rank-aligned adaptive feedback', function() {
    const source = element('Source');
    const target = element('Target');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 0, y: 160, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [],
      {
        ...policy(flow, source, target),
        adaptiveFeedbackSide: true,
        backEdges: new Set([ flow ])
      }
    ), [
      { x: 50, y: 160 },
      { x: 50, y: 80 }
    ]);
  });

  it('should directly route band-aligned adaptive feedback', function() {
    const source = element('Source');
    const target = element('Target');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 200, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [],
      {
        ...policy(flow, source, target),
        adaptiveFeedbackSide: true
      }
    ), [
      { x: 200, y: 40 },
      { x: 100, y: 40 }
    ]);
  });

  it('should honor a facing dock assignment without redundant waypoints', function() {
    const source = element('Source');
    const target = element('Target');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 0, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 200, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [],
      policy(flow, source, target),
      {
        source: 'south',
        target: 'north'
      }
    ), [
      { x: 50, y: 80 },
      { x: 50, y: 200 }
    ]);
  });

  it('should reject an assigned dock that cannot be routed', function() {
    const source = element('Source');
    const target = element('Target');
    const blocker = element('Blocker');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 0, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 200, y: 0, width: 100, height: 80 };

    assert.throws(() => routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      [
        ...shapes(source, sourceBounds, target, targetBounds),
        {
          element: blocker,
          rect: { x: 0, y: -100, width: 100, height: 100 }
        }
      ],
      [],
      policy(flow, source, target),
      {
        source: 'north',
        target: 'west'
      }
    ), (error: unknown) => {
      return error instanceof LayoutError && error.code === 'ROUTING_FAILED';
    });
  });

  it('should route inner feedback above its nested region', function() {
    const source = element('Source');
    const target = element('Target');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 200, y: 160, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [],
      {
        ...policy(flow, source, target),
        backEdges: new Set([ flow ]),
        compactFeedbackNodes: new Set([ source ]),
        innerFeedbackEdges: new Set([ flow ])
      }
    ), [
      { x: 250, y: 160 },
      { x: 250, y: -20 },
      { x: 50, y: -20 },
      { x: 50, y: 0 }
    ]);
  });

  it('should try an east dock for a blocked inner feedback source', function() {
    const source = element('Source');
    const target = element('Target');
    const blocker = element('Blocker');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 200, y: 160, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      [
        ...shapes(source, sourceBounds, target, targetBounds),
        { element: blocker, rect: { x: 230, y: 80, width: 40, height: 40 } }
      ],
      [],
      {
        ...policy(flow, source, target),
        backEdges: new Set([ flow ]),
        compactFeedbackNodes: new Set([ source ]),
        innerFeedbackEdges: new Set([ flow ])
      }
    ), [
      { x: 300, y: 200 },
      { x: 320, y: 200 },
      { x: 320, y: -20 },
      { x: 50, y: -20 },
      { x: 50, y: 0 }
    ]);
  });

  it('should keep inner feedback channels clear of unrelated shapes', function() {
    const source = element('Source');
    const target = element('Target');
    const nearby = element('Nearby');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 200, y: 160, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      [
        ...shapes(source, sourceBounds, target, targetBounds),
        { element: nearby, rect: { x: 100, y: -15, width: 100, height: 80 } }
      ],
      [],
      {
        ...policy(flow, source, target),
        backEdges: new Set([ flow ]),
        compactFeedbackNodes: new Set([ source ]),
        innerFeedbackEdges: new Set([ flow ])
      }
    ), [
      { x: 250, y: 160 },
      { x: 250, y: -40 },
      { x: 50, y: -40 },
      { x: 50, y: 0 }
    ]);
  });

  it('should reserve a bottom channel for nested feedback depth', function() {
    const source = element('Source');
    const target = element('Target');
    const flow = sequenceFlow(source, target);
    const sourceBounds = { x: 200, y: 160, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [],
      {
        ...policy(flow, source, target),
        backEdges: new Set([ flow ]),
        compactFeedbackNodes: new Set([ source ]),
        nestedFeedbackLevels: new Map([ [ flow, 2 ] ])
      }
    ), [
      { x: 300, y: 200 },
      { x: 340, y: 200 },
      { x: 340, y: 280 },
      { x: 50, y: 280 },
      { x: 50, y: 80 }
    ]);
  });

});

function element(id: string): BpmnElementFor<'bpmn:Task'> {
  return moddle.create('bpmn:Task', { id, outgoing: [] });
}

function sequenceFlow(
    sourceRef: BpmnElementFor<'bpmn:Task'>,
    targetRef: BpmnElementFor<'bpmn:Task'>
): Connection {
  const flow = moddle.create('bpmn:SequenceFlow', {
    id: 'Flow',
    sourceRef,
    targetRef
  });

  if (!isConnection(flow, sourceRef, targetRef)) {
    throw new Error('Expected sequence flow endpoints.');
  }

  sourceRef.outgoing?.push(flow);
  return flow;
}

function isConnection(
    flow: BpmnElementFor<'bpmn:SequenceFlow'>,
    sourceRef: BpmnElementFor<'bpmn:Task'>,
    targetRef: BpmnElementFor<'bpmn:Task'>
): flow is BpmnElementFor<'bpmn:SequenceFlow'> & Connection {
  return flow.sourceRef === sourceRef && flow.targetRef === targetRef;
}

function shapes(
    source: BpmnElementFor<'bpmn:Task'>,
    sourceBounds: { x: number; y: number; width: number; height: number },
    target: BpmnElementFor<'bpmn:Task'>,
    targetBounds: { x: number; y: number; width: number; height: number }
): RouterShape[] {
  return [
    { element: source, rect: sourceBounds },
    { element: target, rect: targetBounds }
  ];
}

function policy(
    flow: Connection,
    source: BpmnElementFor<'bpmn:Task'>,
    target: BpmnElementFor<'bpmn:Task'>
): RoutingPolicy {
  return {
    backEdges: new Set<Connection>(),
    bands: new Map([
      [ source, 0 ],
      [ target, 0 ]
    ]),
    straightEdges: new Set([ flow ]),
    spine: new Set<Connection>(),
    graphEdges: [ flow ]
  };
}
