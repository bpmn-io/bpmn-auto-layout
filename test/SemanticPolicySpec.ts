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

  it('should prefer a completing branch that reaches a convergence', function() {
    const automatic = flowNode('bpmn:StartEvent', 'Automatic', {
      outgoing: []
    });
    const start = flowNode('bpmn:StartEvent', 'Start', { outgoing: [] });
    const split = flowNode('bpmn:ExclusiveGateway', 'Split', {
      incoming: [],
      outgoing: []
    });
    const declined = flowNode('bpmn:Task', 'Declined', {
      incoming: [],
      outgoing: []
    });
    const declinedEnd = flowNode('bpmn:EndEvent', 'DeclinedEnd', {
      incoming: []
    });
    const approved = flowNode('bpmn:Task', 'Approved', {
      incoming: [],
      outgoing: []
    });
    const join = flowNode('bpmn:ExclusiveGateway', 'Join', {
      incoming: [],
      outgoing: []
    });
    const approvedEnd = flowNode('bpmn:EndEvent', 'ApprovedEnd', {
      incoming: []
    });
    const automaticJoin = connect(automatic, join, 'AutomaticJoin');
    const incoming = connect(start, split, 'Incoming');
    const approvedBranch = connect(split, approved, 'ApprovedBranch');
    const declinedBranch = connect(split, declined, 'DeclinedBranch');
    const declinedCompletion = connect(
      declined,
      declinedEnd,
      'DeclinedCompletion'
    );
    const approvedJoin = connect(approved, join, 'ApprovedJoin');
    const approvedCompletion = connect(
      join,
      approvedEnd,
      'ApprovedCompletion'
    );

    split.default = declinedBranch;

    const nodes = [
      automatic,
      start,
      split,
      declined,
      declinedEnd,
      approved,
      join,
      approvedEnd
    ];
    const records = nodes.map(flowRecord);
    const policy = createSemanticPolicy(
      moddle.create('bpmn:Process', { id: 'Process' }),
      records,
      [
        automaticJoin,
        incoming,
        approvedBranch,
        declinedBranch,
        declinedCompletion,
        approvedJoin,
        approvedCompletion
      ],
      [],
      records
    );

    assert.strictEqual(policy.straightEdges.has(approvedBranch), true);
    assert.strictEqual(policy.straightEdges.has(declinedBranch), false);
    assert.strictEqual(policy.bands.get(approved), policy.bands.get(split));
    assert.notStrictEqual(policy.bands.get(declined), policy.bands.get(split));
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
    type:
      'bpmn:StartEvent' |
      'bpmn:Task' |
      'bpmn:EndEvent' |
      'bpmn:ExclusiveGateway',
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
    element: BpmnElementFor<
      'bpmn:StartEvent' |
      'bpmn:Task' |
      'bpmn:EndEvent' |
      'bpmn:ExclusiveGateway'
    >
): element is BpmnElementFor<
  'bpmn:StartEvent' |
  'bpmn:Task' |
  'bpmn:EndEvent' |
  'bpmn:ExclusiveGateway'
> & FlowNode {
  return element.$instanceOf('bpmn:FlowNode');
}
