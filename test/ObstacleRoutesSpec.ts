import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  collectArtifactObstacleRoutes
} from '../lib/layout/artifacts/ObstacleRoutes.js';

import type { LayoutState } from '../lib/layout/Types.js';

describe('ObstacleRoutes', function() {

  it('should collect each reserved artifact route once', function() {
    const moddle = new BpmnModdle();
    const flow = moddle.create('bpmn:SequenceFlow', { id: 'Flow' });
    const endpoint = moddle.create('bpmn:Task', { id: 'Endpoint' });
    const layout: LayoutState = {
      scope: moddle.create('bpmn:Process', { id: 'Process' }),
      shapes: new Map(),
      edges: new Map([
        [ flow, [ { x: 0, y: 0 }, { x: 100, y: 0 } ] ]
      ]),
      children: [],
      emitInParent: false
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
