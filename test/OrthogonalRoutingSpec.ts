import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  MAX_VISIBILITY_GRAPH_POINTS,
  ROUTE_COLLISION_TOLERANCE
} from '../lib/layout/Constants.js';
import {
  createBpmnOrthogonalRouter,
  flattenBpmnPath
} from '../lib/layout/routing/BpmnOrthogonalRouting.js';
import {
  createOrthogonalRouter
} from '../lib/layout/routing/OrthogonalRouting.js';

import type {
  BpmnElement,
  BpmnElementFor
} from '../lib/layout/bpmn/Types.js';

const moddle = new BpmnModdle();

describe('OrthogonalRouting', function() {

  it('should bound visibility graph construction', function() {
    const obstacles = Array.from({ length: 33 }, (_, index) => ({
      rect: {
        x: index * 100,
        y: index * 100,
        width: 20,
        height: 20
      }
    }));
    const router = createOrthogonalRouter({
      obstacles,
      maxVisibilityPoints: MAX_VISIBILITY_GRAPH_POINTS,
      collisionTolerance: ROUTE_COLLISION_TOLERANCE
    });

    const route = router.findRoute(
      { x: -20, y: -20 },
      { x: 3240, y: 3240 }
    );

    assert.strictEqual(route, null);
  });


  it('should allow perpendicular crossings but block collinear overlaps', function() {
    const router = createOrthogonalRouter({
      allowPerpendicularCrossings: true,
      routes: [ {
        allowCollinearOverlap: false,
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 }
        ]
      } ]
    });

    assert.strictEqual(router.isSegmentClear(
      { x: 50, y: 0 },
      { x: 50, y: 100 }
    ), true);
    assert.strictEqual(router.isSegmentClear(
      { x: 20, y: 50 },
      { x: 80, y: 50 }
    ), false);
  });


  it('should snapshot obstacles and allocated routes', function() {
    const obstacle = {
      rect: { x: 200, y: 200, width: 20, height: 20 }
    };
    const allocatedRoute = {
      allowCollinearOverlap: false,
      points: [
        { x: 0, y: 50 },
        { x: 100, y: 50 }
      ]
    };
    const router = createOrthogonalRouter({
      obstacles: [ obstacle ],
      routes: [ allocatedRoute ]
    });

    obstacle.rect.x = 40;
    obstacle.rect.y = 40;
    allocatedRoute.points[0].y = 200;
    allocatedRoute.points[1].y = 200;

    assert.strictEqual(router.isSegmentClear(
      { x: 20, y: 50 },
      { x: 80, y: 50 }
    ), false);
    assert.strictEqual(router.isSegmentClear(
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ), true);
  });

  it('should apply clearance per constrained path section', function() {
    const router = createOrthogonalRouter({
      obstacles: [ {
        rect: { x: 40, y: 40, width: 20, height: 20 }
      } ]
    });
    const sourceDock = {
      obstacleClearance: 0,
      points: [
        { x: 0, y: 30 },
        { x: 20, y: 30 }
      ]
    };

    assert.strictEqual(router.isPathClear({
      sections: [
        sourceDock,
        {
          obstacleClearance: 0,
          points: [
            { x: 20, y: 30 },
            { x: 80, y: 30 }
          ]
        }
      ]
    }), true);
    assert.strictEqual(router.isPathClear({
      sections: [
        sourceDock,
        {
          obstacleClearance: 11,
          points: [
            { x: 20, y: 30 },
            { x: 80, y: 30 }
          ]
        }
      ]
    }), false);
  });

  it('should apply obstacle exemptions per constrained path section', function() {
    const obstacle = Symbol('obstacle');
    const router = createOrthogonalRouter({
      obstacles: [ {
        id: obstacle,
        rect: { x: 40, y: 40, width: 20, height: 20 }
      } ]
    });
    const points = [
      { x: 0, y: 50 },
      { x: 100, y: 50 }
    ];

    assert.strictEqual(router.isPathClear({
      sections: [ {
        obstacleClearance: 0,
        points
      } ]
    }), false);
    assert.strictEqual(router.isPathClear({
      sections: [ {
        exemptObstacleIds: [ obstacle ],
        obstacleClearance: 0,
        points
      } ]
    }), true);
  });

  it('should override clearance for one obstacle without exempting it', function() {
    const obstacle = Symbol('obstacle');
    const router = createOrthogonalRouter({
      obstacles: [ {
        id: obstacle,
        rect: { x: 40, y: 40, width: 20, height: 20 }
      } ]
    });

    assert.strictEqual(router.isPathClear({
      sections: [ {
        obstacleClearance: 11,
        obstacleOverrides: [ {
          collisionTolerance: ROUTE_COLLISION_TOLERANCE,
          id: obstacle
        } ],
        points: [
          { x: 0, y: 30 },
          { x: 100, y: 30 }
        ]
      } ]
    }), true);
    assert.strictEqual(router.isPathClear({
      sections: [ {
        obstacleClearance: 11,
        obstacleOverrides: [ {
          collisionTolerance: ROUTE_COLLISION_TOLERANCE,
          id: obstacle
        } ],
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 }
        ]
      } ]
    }), false);
  });

  it('should reject invalid constrained paths', function() {
    const router = createOrthogonalRouter();

    assert.throws(() => {
      router.isPathClear({
        sections: [ {
          obstacleClearance: -1,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 }
          ]
        } ]
      });
    }, TypeError);
    assert.throws(() => {
      router.isPathClear({
        sections: [
          {
            obstacleClearance: 0,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 }
            ]
          },
          {
            obstacleClearance: 0,
            points: [
              { x: 40, y: 0 },
              { x: 60, y: 0 }
            ]
          }
        ]
      });
    }, TypeError);
  });


  it('should reject invalid geometry descriptors', function() {
    assert.throws(() => {
      createOrthogonalRouter({
        obstacles: [ {
          rect: { x: Infinity, y: 0, width: 20, height: 20 }
        } ]
      });
    }, TypeError);
    assert.throws(() => {
      createOrthogonalRouter({
        routes: [ {
          points: [
            { x: 0, y: 0 },
            { x: Number.NaN, y: 20 }
          ]
        } ]
      });
    }, TypeError);
    assert.throws(() => {
      createOrthogonalRouter({
        obstacles: [
          {
            id: 'duplicate',
            rect: { x: 0, y: 0, width: 20, height: 20 }
          },
          {
            id: 'duplicate',
            rect: { x: 40, y: 0, width: 20, height: 20 }
          }
        ]
      });
    }, TypeError);
  });
});

describe('BpmnOrthogonalRouting', function() {

  it('should only exempt endpoint obstacles on docking sections', function() {
    const source = element('Source');
    const target = element('Target');
    const router = createBpmnOrthogonalRouter({
      shapes: [
        {
          element: source,
          rect: { x: 0, y: 0, width: 100, height: 80 }
        },
        {
          element: target,
          rect: { x: 200, y: 0, width: 100, height: 80 }
        }
      ],
      sourceElement: source,
      targetElement: target
    });

    assert.strictEqual(router.isBpmnPathClear({
      sections: [
        {
          role: 'source-dock',
          points: [
            { x: 50, y: 40 },
            { x: 100, y: 40 }
          ]
        },
        {
          role: 'connector',
          points: [
            { x: 100, y: 40 },
            { x: 0, y: 40 }
          ]
        },
        {
          role: 'target-dock',
          points: [
            { x: 0, y: 40 },
            { x: 200, y: 40 }
          ]
        }
      ]
    }, {
      channelClearance: 0
    }), false);
  });


  it('should allow shared endpoint channels only', function() {
    const source = element('Source');
    const target = element('Target');
    const otherSource = element('OtherSource');
    const otherTarget = element('OtherTarget');
    const points = [
      { x: 0, y: 50 },
      { x: 100, y: 50 }
    ];
    const sharedRouter = createBpmnOrthogonalRouter({
      routedConnections: [ {
        flow: sequenceFlow(source, otherTarget),
        points
      } ],
      sourceElement: source,
      targetElement: target
    });
    const separateRouter = createBpmnOrthogonalRouter({
      routedConnections: [ {
        flow: sequenceFlow(otherSource, otherTarget),
        points
      } ],
      sourceElement: source,
      targetElement: target
    });

    assert.strictEqual(sharedRouter.isSegmentClear(points[0], points[1]), true);
    assert.strictEqual(separateRouter.isSegmentClear(points[0], points[1]), false);
  });

  it('should map BPMN channel roles to configured clearance', function() {
    const source = element('Source');
    const target = element('Target');
    const nearby = element('Nearby');
    const router = createBpmnOrthogonalRouter({
      shapes: [ {
        element: nearby,
        rect: { x: 40, y: 40, width: 20, height: 20 }
      } ],
      sourceElement: source,
      targetElement: target
    });
    const path = {
      sections: [
        {
          role: 'source-dock' as const,
          points: [
            { x: 0, y: 30 },
            { x: 20, y: 30 }
          ]
        },
        {
          role: 'channel' as const,
          points: [
            { x: 20, y: 30 },
            { x: 80, y: 30 }
          ]
        },
        {
          role: 'target-dock' as const,
          points: [
            { x: 80, y: 30 },
            { x: 100, y: 30 }
          ]
        }
      ]
    };

    assert.strictEqual(router.isBpmnPathClear(path, {
      channelClearance: 0
    }), true);
    assert.strictEqual(router.isBpmnPathClear(path, {
      channelClearance: 11
    }), false);
    assert.deepStrictEqual(flattenBpmnPath(path), [
      { x: 0, y: 30 },
      { x: 20, y: 30 },
      { x: 80, y: 30 },
      { x: 100, y: 30 }
    ]);
  });

  it('should deduplicate endpoint overrides for constrained self-loops', function() {
    const endpoint = element('Endpoint');
    const router = createBpmnOrthogonalRouter({
      shapes: [ {
        element: endpoint,
        rect: { x: 40, y: 40, width: 20, height: 20 }
      } ],
      sourceElement: endpoint,
      targetElement: endpoint
    });

    assert.strictEqual(router.isBpmnPathClear({
      sections: [
        {
          role: 'source-dock',
          points: [
            { x: 40, y: 50 },
            { x: 20, y: 50 }
          ]
        },
        {
          role: 'channel',
          points: [
            { x: 20, y: 50 },
            { x: 20, y: 20 },
            { x: 50, y: 20 }
          ]
        },
        {
          role: 'target-dock',
          points: [
            { x: 50, y: 20 },
            { x: 50, y: 40 }
          ]
        }
      ]
    }, {
      channelClearance: 20
    }), true);
  });

  it('should reject invalid BPMN path role order', function() {
    assert.throws(() => {
      flattenBpmnPath({
        sections: [
          {
            role: 'connector',
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 }
            ]
          },
          {
            role: 'source-dock',
            points: [
              { x: 20, y: 0 },
              { x: 40, y: 0 }
            ]
          }
        ]
      });
    }, TypeError);
  });
});

function element(id: string): BpmnElementFor<'bpmn:Task'> {
  return moddle.create('bpmn:Task', { id });
}

function sequenceFlow(
    sourceRef: BpmnElement,
    targetRef: BpmnElement
): BpmnElementFor<'bpmn:SequenceFlow'> {
  return moddle.create('bpmn:SequenceFlow', { sourceRef, targetRef });
}
