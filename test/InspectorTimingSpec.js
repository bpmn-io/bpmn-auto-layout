import assert from 'node:assert';

import {
  INSPECTOR_LAYOUT_TIMING_RUNS,
  shouldMeasureLayoutTimings
} from './inspector/Timing.js';

describe('Inspector timing', function() {

  it('should only measure timings when the inspector enables them', function() {
    assert.strictEqual(shouldMeasureLayoutTimings({}), false);
    assert.strictEqual(
      shouldMeasureLayoutTimings({ INSPECTOR_TIMINGS: 'false' }),
      false
    );
    assert.strictEqual(
      shouldMeasureLayoutTimings({ INSPECTOR_TIMINGS: 'true' }),
      true
    );
    assert.strictEqual(INSPECTOR_LAYOUT_TIMING_RUNS, 5);
  });
});
