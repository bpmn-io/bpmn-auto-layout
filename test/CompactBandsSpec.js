import assert from 'node:assert';

import {
  compactSemanticBands
} from '../lib/layout/process/semantics/CompactBands.js';

describe('CompactBands', function() {

  it('should reuse compacted bands only for disjoint rank intervals', function() {
    const first = {};
    const disjoint = {};
    const overlapping = {};
    const records = [ first, disjoint, overlapping ].map(element => ({
      element
    }));
    const policy = {
      bands: new Map([
        [ first, 2 ],
        [ disjoint, 4 ],
        [ overlapping, 6 ]
      ]),
      components: new Map([
        [ first, 0 ],
        [ disjoint, 0 ],
        [ overlapping, 0 ]
      ]),
      backEdges: new Set(),
      boundaryBayEdges: new Set()
    };
    const ranks = {
      rank: new Map([
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
