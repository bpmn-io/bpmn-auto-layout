import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  compactSemanticBands
} from '../lib/layout/process/semantics/CompactBands.js';

const moddle = new BpmnModdle();

type FlowNode = Parameters<typeof compactSemanticBands>[0][number]['element'];
type FlowEdge = Parameters<typeof compactSemanticBands>[1][number];
type FlowRecord = Parameters<typeof compactSemanticBands>[0][number];
type RankAssignment = Parameters<typeof compactSemanticBands>[3];
type SemanticPolicy = Parameters<typeof compactSemanticBands>[4];

describe('CompactBands', function() {

  it('should reuse compacted bands only for disjoint rank intervals', function() {
    const first = flowNode('First');
    const disjoint = flowNode('Disjoint');
    const overlapping = flowNode('Overlapping');
    const records = [ first, disjoint, overlapping ].map(flowRecord);
    const policy: SemanticPolicy = {
      bands: new Map<FlowNode, number>([
        [ first, 2 ],
        [ disjoint, 4 ],
        [ overlapping, 6 ]
      ]),
      components: new Map<FlowNode, number>([
        [ first, 0 ],
        [ disjoint, 0 ],
        [ overlapping, 0 ]
      ]),
      backEdges: new Set<FlowEdge>(),
      boundaryBayEdges: new Set<FlowEdge>(),
      spine: new Set<FlowEdge>(),
      straightEdges: new Set<FlowEdge>(),
      edgeOrder: new Map(),
      flowNodeDocumentIndex: new Map(),
      graphEdges: [],
      compactFlowRegions: [],
      rankWeights: new Map()
    };
    const ranks: RankAssignment = {
      rank: new Map<FlowNode, number>([
        [ first, 0 ],
        [ disjoint, 2 ],
        [ overlapping, 0 ]
      ])
    };

    compactSemanticBands(records, [], [], ranks, policy);

    assert.deepStrictEqual(
      [ first, disjoint, overlapping ].map(element => {
        return policy.bands.get(element);
      }),
      [ 1, 1, 2 ]
    );
  });
});

function flowNode(id: string): FlowNode {
  return moddle.create('bpmn:Task', { id });
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
