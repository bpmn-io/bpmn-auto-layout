import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  assignRanks,
  createSemanticPolicy
} from '../lib/layout/process/semantics/SemanticPolicy.js';

import type { BpmnElementFor } from '../lib/layout/bpmn/Types.js';

const moddle = new BpmnModdle();

type FlowNode = Parameters<typeof createSemanticPolicy>[1][number]['element'];
type FlowEdge = Parameters<typeof createSemanticPolicy>[2][number];
type FlowRecord = Parameters<typeof createSemanticPolicy>[1][number];

describe('SemanticPolicy', function() {

  it('should assemble components, spine, bands, and ranks', function() {
    const start = flowNode('bpmn:StartEvent', 'Start', { outgoing: [] });
    const task = flowNode('bpmn:Task', 'Task', { outgoing: [] });
    const end = flowNode('bpmn:EndEvent', 'End', { incoming: [] });
    const first = connect(start, task, 'First');
    const second = connect(task, end, 'Second');
    const records = [ start, task, end ].map(flowRecord);
    const policy = createSemanticPolicy(
      moddle.create('bpmn:Process', { id: 'Process' }),
      records,
      [ first, second ],
      [],
      records
    );
    const ranks = assignRanks(records, [ first, second ], [], policy);

    assert.deepStrictEqual([ ...policy.spine ], [ first, second ]);
    assert.deepStrictEqual([ ...policy.straightEdges ], [ first, second ]);
    assert.deepStrictEqual(
      [ start, task, end ].map(node => policy.components.get(node)),
      [ 0, 0, 0 ]
    );
    assert.deepStrictEqual(
      [ start, task, end ].map(node => policy.bands.get(node)),
      [ 0, 0, 0 ]
    );
    assert.deepStrictEqual(
      [ start, task, end ].map(node => ranks.rank.get(node)),
      [ 0, 1, 2 ]
    );
  });
});

function connect(sourceRef: FlowNode, targetRef: FlowNode, id: string): FlowEdge {
  const edge = moddle.create('bpmn:SequenceFlow', { id, sourceRef, targetRef });

  if (!isFlowEdge(edge, sourceRef, targetRef)) {
    throw new Error('Expected sequence flow endpoints.');
  }

  sourceRef.outgoing?.push(edge);
  targetRef.incoming?.push(edge);
  return edge;
}

function isFlowEdge(
    edge: BpmnElementFor<'bpmn:SequenceFlow'>,
    sourceRef: FlowNode,
    targetRef: FlowNode
): edge is BpmnElementFor<'bpmn:SequenceFlow'> & FlowEdge {
  return edge.sourceRef === sourceRef && edge.targetRef === targetRef;
}

function flowRecord(element: FlowNode, index: number): FlowRecord {
  return {
    element,
    index,
    size: { width: 0, height: 0 },
    isBoundary: false,
    isArtifact: false,
    expanded: false,
    child: null
  };
}

function flowNode(
    type: 'bpmn:StartEvent' | 'bpmn:Task' | 'bpmn:EndEvent',
    id: string,
    attributes: { incoming?: BpmnElementFor<'bpmn:SequenceFlow'>[]; outgoing?: BpmnElementFor<'bpmn:SequenceFlow'>[] }
): FlowNode {
  const element = moddle.create(type, { id, ...attributes });

  if (!isFlowNode(element)) {
    throw new Error('Expected a flow node.');
  }

  return element;
}

function isFlowNode(
    element: BpmnElementFor<'bpmn:StartEvent' | 'bpmn:Task' | 'bpmn:EndEvent'>
): element is BpmnElementFor<'bpmn:StartEvent' | 'bpmn:Task' | 'bpmn:EndEvent'> & FlowNode {
  return element.$instanceOf('bpmn:FlowNode');
}
