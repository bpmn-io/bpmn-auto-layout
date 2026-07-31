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
