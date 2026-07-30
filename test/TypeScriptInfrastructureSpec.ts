import assert from 'node:assert';

import type { Bounds } from '../lib/layout/Types.js';

describe('TypeScript infrastructure', function() {

  it('should execute TypeScript tests', function() {
    const bounds: Bounds = {
      x: 10,
      y: 20,
      width: 30,
      height: 40
    };

    assert.deepStrictEqual(bounds, {
      x: 10,
      y: 20,
      width: 30,
      height: 40
    });
  });
});
