import assert from 'node:assert';

import {
  compareArtifactPlacementScores,
  createArtifactPlacementScore
} from '../lib/layout/artifacts/PlacementScoring.js';

describe('PlacementScoring', function() {

  it('should compare placement scores by named priority', function() {
    const score = overrides => createArtifactPlacementScore({
      participantInteriorViolation: 0,
      dataCrossings: 0,
      congestionViolation: 0,
      missesOwnerAlignment: 0,
      alignedOwnerReward: 0,
      associationBends: 0,
      weightedLength: 0,
      associationLength: 0,
      annotationSize: 0,
      annotationCrossings: 0,
      containmentViolation: 0,
      expansion: 0,
      sideRank: 0,
      offset: 0,
      gap: 0,
      y: 0,
      x: 0,
      ...overrides
    });

    assert.ok(compareArtifactPlacementScores(
      score({ participantInteriorViolation: 1 }),
      score({ dataCrossings: 1 })
    ) > 0);
    assert.ok(compareArtifactPlacementScores(
      score({ y: 1 }),
      score({ x: 1 })
    ) > 0);
    assert.strictEqual(compareArtifactPlacementScores(score(), score()), 0);
  });
});
