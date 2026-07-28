import assert from 'node:assert';

import {
  compareArtifactPlacementScores,
  createArtifactPlacementScore
} from '../lib/layout/artifacts/ArtifactLayout.js';
import {
  collectArtifactObstacleRoutes
} from '../lib/layout/artifacts/index.js';

describe('ArtifactLayout', function() {

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


  it('should collect each reserved artifact route once', function() {
    const flow = {
      $instanceOf(type) {
        return type === 'bpmn:SequenceFlow';
      }
    };
    const endpoint = {};
    const layout = {
      edges: new Map([
        [ flow, [ { x: 0, y: 0 }, { x: 100, y: 0 } ] ]
      ]),
      children: []
    };
    const routes = collectArtifactObstacleRoutes(
      layout,
      new Map([
        [ endpoint, new Set([ 'incoming', 'outgoing' ]) ]
      ]),
      new Map([
        [ endpoint, { x: 100, y: 200, width: 40, height: 60 } ]
      ])
    );

    assert.strictEqual(routes.length, 3);
    assert.deepStrictEqual(routes.slice(1), [
      {
        element: endpoint,
        points: [ { x: 120, y: 200 }, { x: 120, y: -200 } ]
      },
      {
        element: endpoint,
        points: [ { x: 120, y: 260 }, { x: 120, y: 660 } ]
      }
    ]);
  });
});
