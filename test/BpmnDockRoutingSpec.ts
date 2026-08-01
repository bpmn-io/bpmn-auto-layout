import assert from 'node:assert';

import { describe, it } from 'mocha';

import {
  createDockCandidates,
  createDockPairs
} from '../lib/layout/routing/BpmnDockRouting.js';

describe('BpmnDockRouting', function() {

  it('should generate deterministic outward dock candidates', function() {
    const candidates = createDockCandidates({
      preferredDock: { x: 100, y: 40 },
      rect: { x: 0, y: 0, width: 100, height: 80 }
    });

    assert.deepStrictEqual(candidates.map(candidate => ({
      dock: candidate.dock,
      penalty: candidate.semanticPenalty,
      side: candidate.side,
      stub: candidate.stub
    })), [
      {
        dock: { x: 100, y: 40 },
        penalty: 0,
        side: 'east',
        stub: { x: 120, y: 40 }
      },
      {
        dock: { x: 50, y: 0 },
        penalty: 1,
        side: 'north',
        stub: { x: 50, y: -20 }
      },
      {
        dock: { x: 50, y: 80 },
        penalty: 1,
        side: 'south',
        stub: { x: 50, y: 100 }
      },
      {
        dock: { x: 0, y: 40 },
        penalty: 2,
        side: 'west',
        stub: { x: -20, y: 40 }
      }
    ]);
  });

  it('should bound and order legal dock pairs', function() {
    const source = createDockCandidates({
      allowedSides: [ 'east', 'south' ],
      preferredDock: { x: 100, y: 40 },
      rect: { x: 0, y: 0, width: 100, height: 80 }
    });
    const target = createDockCandidates({
      allowedSides: [ 'north', 'west' ],
      preferredDock: { x: 200, y: 40 },
      rect: { x: 200, y: 0, width: 100, height: 80 }
    });
    const pairs = createDockPairs(source, target);

    assert.strictEqual(pairs.length, 4);
    assert.deepStrictEqual(pairs.map(pair => [
      pair.source.side,
      pair.target.side
    ]), [
      [ 'east', 'west' ],
      [ 'east', 'north' ],
      [ 'south', 'west' ],
      [ 'south', 'north' ]
    ]);
  });

});
