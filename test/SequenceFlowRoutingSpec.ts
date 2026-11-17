import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  routeConnection
} from '../lib/layout/process/routing/SequenceFlowRouting.js';

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


  it('should route a parallel flow around the flow already routed between the same elements', function() {
    const source = element('Source');
    const target = element('Target');
    const routed = sequenceFlow(source, target, 'Flow_1');
    const flow = sequenceFlow(source, target, 'Flow_2');
    const sourceBounds = { x: 0, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 200, y: 0, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [ { flow: routed, points: [ { x: 100, y: 40 }, { x: 200, y: 40 } ] } ],
      policy(flow, source, target)
    ), [
      { x: 50, y: 80 },
      { x: 50, y: 100 },
      { x: 250, y: 100 },
      { x: 250, y: 80 }
    ]);
  });


  it('should route a parallel flow beside vertically stacked elements', function() {
    const source = element('Source');
    const target = element('Target');
    const routed = sequenceFlow(source, target, 'Flow_1');
    const flow = sequenceFlow(source, target, 'Flow_2');
    const sourceBounds = { x: 0, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 0, y: 160, width: 100, height: 80 };

    assert.deepStrictEqual(routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      shapes(source, sourceBounds, target, targetBounds),
      [ { flow: routed, points: [ { x: 50, y: 80 }, { x: 50, y: 160 } ] } ],
      policy(flow, source, target)
    ), [
      { x: 100, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 200 },
      { x: 100, y: 200 }
    ]);
  });


  it('should give every nested parallel flow its own activity docks', function() {
    const source = element('Source');
    const target = element('Target');
    const other = element('Other');
    const first = sequenceFlow(source, target, 'Flow_1');
    const sibling = sequenceFlow(source, other, 'Flow_other');
    const flows = [ 2, 3, 4, 5 ].map(index => sequenceFlow(source, target, `Flow_${ index }`));
    const sourceBounds = { x: 0, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 200, y: 0, width: 100, height: 80 };
    const otherBounds = { x: 200, y: 160, width: 100, height: 80 };
    const routed = [
      { flow: first, points: [ { x: 100, y: 40 }, { x: 200, y: 40 } ] },
      { flow: sibling, points: [ { x: 50, y: 80 }, { x: 50, y: 200 }, { x: 200, y: 200 } ] }
    ];

    for (const flow of flows) {
      const points = routeConnection(
        flow,
        sourceBounds,
        targetBounds,
        [ ...shapes(source, sourceBounds, target, targetBounds), { element: other, rect: otherBounds } ],
        routed,
        policy(flow, source, target)
      );

      routed.push({ flow, points });
    }

    const bypasses = routed.slice(2).map(({ points }) => points);
    const starts = bypasses.map(points => points[0]);
    const ends = bypasses.map(points => points[points.length - 1]);

    assert.ok(starts.every(({ y }) => y === sourceBounds.y));
    assert.ok(ends.every(({ y }) => y === targetBounds.y));
    assert.strictEqual(new Set(starts.map(({ x }) => x)).size, flows.length);
    assert.strictEqual(new Set(ends.map(({ x }) => x)).size, flows.length);
    assert.ok(ends.every(({ x }) => x > targetBounds.x && x < targetBounds.x + targetBounds.width));
  });


  it('should move the activity dock away from a sibling when only an occupied side is clear', function() {
    const source = element('Source');
    const target = element('Target');
    const other = element('Other');
    const blocker = element('Blocker');
    const first = sequenceFlow(source, target, 'Flow_1');
    const sibling = sequenceFlow(source, other, 'Flow_other');
    const flow = sequenceFlow(source, target, 'Flow_2');
    const sourceBounds = { x: 0, y: 0, width: 100, height: 80 };
    const targetBounds = { x: 200, y: 0, width: 100, height: 80 };
    const otherBounds = { x: 200, y: 160, width: 100, height: 80 };
    const blockerBounds = { x: -100, y: -460, width: 500, height: 456 };

    const points = routeConnection(
      flow,
      sourceBounds,
      targetBounds,
      [
        ...shapes(source, sourceBounds, target, targetBounds),
        { element: other, rect: otherBounds },
        { element: blocker, rect: blockerBounds }
      ],
      [
        { flow: first, points: [ { x: 100, y: 40 }, { x: 200, y: 40 } ] },
        { flow: sibling, points: [ { x: 50, y: 80 }, { x: 50, y: 200 }, { x: 200, y: 200 } ] }
      ],
      policy(flow, source, target)
    );

    assert.deepStrictEqual(points[0], { x: 70, y: 80 });
    assert.deepStrictEqual(points[points.length - 1], { x: 250, y: 80 });
  });

});

function element(id: string): BpmnElementFor<'bpmn:Task'> {
  return moddle.create('bpmn:Task', { id, outgoing: [] });
}

function sequenceFlow(
    sourceRef: BpmnElementFor<'bpmn:Task'>,
    targetRef: BpmnElementFor<'bpmn:Task'>,
    id = 'Flow'
): Connection {
  const flow = moddle.create('bpmn:SequenceFlow', {
    id,
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
