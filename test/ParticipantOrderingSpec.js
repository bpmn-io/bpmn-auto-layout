import assert from 'node:assert';

import {
  participantOrderingStrategy
} from '../lib/layout/collaboration/ordering/ParticipantOrdering.js';

describe('ParticipantOrdering', function() {

  it('should bound exhaustive participant ordering', function() {
    assert.strictEqual(participantOrderingStrategy(8), 'exhaustive');
    assert.strictEqual(participantOrderingStrategy(9), 'heuristic');
  });
});
