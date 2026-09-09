import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  MAX_VISIBILITY_GRAPH_POINTS,
  ROUTE_OBSTACLE_INSET
} from '../lib/layout/Constants.js';
import {
  createBpmnOrthogonalRouter
} from '../lib/layout/routing/BpmnOrthogonalRouting.js';
import {
  createOrthogonalRouter
} from '../lib/layout/routing/OrthogonalRouting.js';
import {
  parallelProximityOverlap
} from '../lib/layout/geometry/index.js';

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
      obstacleInset: ROUTE_OBSTACLE_INSET
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
  });
});

describe('BpmnOrthogonalRouting', function() {

  it('should exclude endpoint obstacles', function() {
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

    assert.strictEqual(router.isSegmentClear(
      { x: 0, y: 40 },
      { x: 300, y: 40 }
    ), true);
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
});

describe('parallelProximityOverlap', function() {

  it('should detect near-parallel overlapping segments below the separation', function() {
    assert.strictEqual(parallelProximityOverlap(
      { x: 0, y: 50 }, { x: 100, y: 50 },
      { x: 40, y: 48 }, { x: 140, y: 48 },
      20
    ), true);
  });

  it('should ignore exactly collinear segments (zero separation)', function() {
    assert.strictEqual(parallelProximityOverlap(
      { x: 0, y: 50 }, { x: 100, y: 50 },
      { x: 40, y: 50 }, { x: 140, y: 50 },
      20
    ), false);
  });

  it('should ignore segments at or beyond the separation', function() {
    assert.strictEqual(parallelProximityOverlap(
      { x: 0, y: 50 }, { x: 100, y: 50 },
      { x: 40, y: 70 }, { x: 140, y: 70 },
      20
    ), false);
  });

  it('should ignore parallel segments that do not overlap on the shared axis', function() {
    assert.strictEqual(parallelProximityOverlap(
      { x: 0, y: 50 }, { x: 100, y: 50 },
      { x: 120, y: 48 }, { x: 200, y: 48 },
      20
    ), false);
  });

  it('should ignore perpendicular segments', function() {
    assert.strictEqual(parallelProximityOverlap(
      { x: 0, y: 50 }, { x: 100, y: 50 },
      { x: 50, y: 0 }, { x: 50, y: 100 },
      20
    ), false);
  });
});

describe('OrthogonalRouting minParallelSeparation', function() {

  it('should reject a near-parallel overlapping route but keep crossings and distant lanes clear', function() {
    const router = createOrthogonalRouter({
      allowPerpendicularCrossings: true,
      minParallelSeparation: 20,
      routes: [ {
        allowCollinearOverlap: false,
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 }
        ]
      } ]
    });

    // Near-parallel overlap two pixels away reads as a doubled line.
    assert.strictEqual(router.isSegmentClear(
      { x: 20, y: 48 },
      { x: 80, y: 48 }
    ), false);

    // A full lane away is a legitimate separate channel.
    assert.strictEqual(router.isSegmentClear(
      { x: 20, y: 30 },
      { x: 80, y: 30 }
    ), true);

    // A perpendicular crossing is not a parallel overlap.
    assert.strictEqual(router.isSegmentClear(
      { x: 50, y: 0 },
      { x: 50, y: 100 }
    ), true);
  });

  it('should exempt shared endpoint channels from the separation', function() {
    const router = createOrthogonalRouter({
      minParallelSeparation: 20,
      routes: [ {
        allowCollinearOverlap: true,
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 }
        ]
      } ]
    });

    assert.strictEqual(router.isSegmentClear(
      { x: 20, y: 48 },
      { x: 80, y: 48 }
    ), true);
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
