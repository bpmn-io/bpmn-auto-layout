import assert from 'node:assert';

import {
  MAX_VISIBILITY_GRAPH_POINTS,
  ROUTE_OBSTACLE_INSET
} from '../lib/layout/Constants.js';
import { visibilityRoute } from '../lib/layout/SequenceFlowRouter.js';

describe('SequenceFlowRouter', function() {

  it('should bound visibility graph construction', function() {
    const shapes = Array.from({ length: 33 }, (_, index) => ({
      element: {},
      rect: {
        x: index * 100,
        y: index * 100,
        width: 20,
        height: 20
      }
    }));

    const route = visibilityRoute(
      { x: -20, y: -20 },
      { x: 3240, y: 3240 },
      shapes,
      null,
      null,
      [],
      ROUTE_OBSTACLE_INSET,
      false,
      MAX_VISIBILITY_GRAPH_POINTS
    );

    assert.strictEqual(route, null);
  });
});
