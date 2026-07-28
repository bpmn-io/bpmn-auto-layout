import assert from 'node:assert';

import {
  assignRanks,
  createSemanticPolicy
} from '../lib/layout/process/semantics/SemanticPolicy.js';

describe('SemanticPolicy', function() {

  it('should assemble components, spine, bands, and ranks', function() {
    const start = element('Start', 'bpmn:StartEvent');
    const task = element('Task');
    const end = element('End', 'bpmn:EndEvent');
    const first = connect(start, task, 'First');
    const second = connect(task, end, 'Second');
    const records = [ start, task, end ].map((node, index) => ({
      element: node,
      index
    }));
    const policy = createSemanticPolicy(
      element('Process', 'bpmn:Process'),
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

function connect(sourceRef, targetRef, id) {
  const edge = { id, sourceRef, targetRef };

  sourceRef.outgoing.push(edge);
  targetRef.incoming.push(edge);
  return edge;
}

function element(id, type) {
  return {
    id,
    incoming: [],
    outgoing: [],
    eventDefinitions: [],
    $instanceOf(candidate) {
      return candidate === type;
    }
  };
}
