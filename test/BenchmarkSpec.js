import assert from 'node:assert';

import {
  calculateStatistics,
  parseIterationCount,
  resolveFixturePath
} from '../tasks/benchmark-fixture.mjs';

describe('Fixture benchmark', function() {

  it('should calculate average, p50, and p90 timings', function() {
    assert.deepStrictEqual(calculateStatistics([ 40, 10, 30, 20, 50 ]), {
      averageMs: 30,
      p50Ms: 30,
      p90Ms: 46
    });
  });

  it('should reject invalid iteration counts', function() {
    for (const value of [ undefined, '0', '-1', '1.5', 'not-a-number' ]) {
      assert.throws(() => parseIterationCount(value), {
        message: 'Iteration count must be a positive integer.'
      });
    }
  });

  it('should resolve a repository-relative fixture path', async function() {
    const { fixtureRelativePath } = await resolveFixturePath(
      './test/fixtures/scenario.simple.bpmn'
    );

    assert.strictEqual(fixtureRelativePath, 'scenario.simple.bpmn');
  });
});
