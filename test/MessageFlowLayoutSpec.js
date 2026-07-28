import assert from 'node:assert';

import {
  participantOrderingStrategy
} from '../lib/layout/collaboration/MessageFlowLayout.js';

describe('MessageFlowLayout', function() {

  it('should bound exhaustive participant ordering', function() {
    assert.strictEqual(participantOrderingStrategy(8), 'exhaustive');
    assert.strictEqual(participantOrderingStrategy(9), 'heuristic');
  });
});
