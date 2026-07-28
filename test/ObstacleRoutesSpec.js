import assert from 'node:assert';

import {
  collectArtifactObstacleRoutes
} from '../lib/layout/artifacts/ObstacleRoutes.js';

describe('ObstacleRoutes', function() {

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
