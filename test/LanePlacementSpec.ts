import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  applyLaneMembership
} from '../lib/layout/process/placement/LanePlacement.js';

import type { LayoutState } from '../lib/layout/Types.js';

const moddle = new BpmnModdle();

type FlowEdge = Parameters<typeof applyLaneMembership>[2][number];
type LaneRecord = Parameters<typeof applyLaneMembership>[1][number];
type LanePolicy = Parameters<typeof applyLaneMembership>[3];

describe('LanePlacement', function() {

  it('should validate, measure, and position lane content', function() {
    const task = moddle.create('bpmn:Task', { id: 'Task' });
    const lane = moddle.create('bpmn:Lane', {
      id: 'Lane',
      flowNodeRef: [ task ]
    });
    const scope = moddle.create('bpmn:Process', {
      laneSets: [ moddle.create('bpmn:LaneSet', { lanes: [ lane ] }) ]
    });
    const record: LaneRecord = {
      element: task,
      index: 0,
      size: { width: 100, height: 80 },
      isBoundary: false,
      isArtifact: false,
      expanded: false,
      child: null,
      bounds: { x: 0, y: 0, width: 100, height: 80 }
    };
    const layout: LayoutState = {
      scope,
      shapes: new Map(),
      edges: new Map(),
      children: [],
      emitInParent: false
    };
    const policy: LanePolicy = {
      backEdges: new Set<FlowEdge>(),
      straightEdges: new Set<FlowEdge>()
    };

    applyLaneMembership(scope, [ record ], [], policy, layout);

    assert.deepStrictEqual(layout.shapes.get(lane), {
      x: 0,
      y: 0,
      width: 380,
      height: 240
    });
    assert.deepStrictEqual(record.bounds, {
      x: 40,
      y: 80,
      width: 100,
      height: 80
    });
  });

  it('should preserve compact feedback rows inside a lane', function() {
      const first = moddle.create('bpmn:Task', { id: 'First' });
      const second = moddle.create('bpmn:Task', { id: 'Second' });
      const lane = moddle.create('bpmn:Lane', {
        id: 'Lane',
        flowNodeRef: [ first, second ]
      });
      const scope = moddle.create('bpmn:Process', {
        laneSets: [ moddle.create('bpmn:LaneSet', { lanes: [ lane ] }) ]
      });
      const records: LaneRecord[] = [ first, second ].map((element, index) => ({
        element,
        index,
        size: { width: 100, height: 80 },
        isBoundary: false,
        isArtifact: false,
        expanded: false,
        child: null,
        bounds: { x: index * 200, y: index * 160, width: 100, height: 80 }
      }));
      const layout: LayoutState = {
        scope,
        shapes: new Map(),
        edges: new Map(),
        children: [],
        emitInParent: false
      };
      const policy: LanePolicy = {
        backEdges: new Set<FlowEdge>(),
        straightEdges: new Set<FlowEdge>(),
        compactFeedbackNodes: new Set([ second ])
      };

      applyLaneMembership(scope, records, [], policy, layout);

      assert.strictEqual(layout.shapes.get(lane)?.height, 350);
      assert.strictEqual(records[0].bounds.y, 80);
      assert.strictEqual(records[1].bounds.y, 190);
  });
});
