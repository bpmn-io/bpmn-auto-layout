import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  bounds,
  createLayout
} from '../lib/layout/geometry/index.js';
import {
  introducesHardDefect
} from '../lib/layout/process/optimization/LayoutScoring.js';
import {
  clonePlacementCandidate,
  commitPlacementCandidate,
  createBaselineCandidate
} from '../lib/layout/process/optimization/PlacementCandidate.js';

const moddle = new BpmnModdle();

describe('PlacementOptimizer', function() {

  it('should isolate candidate geometry from committed layout state', function() {
    const layout = createCandidateLayout();
    const originalBounds = layout.shapes.values().next().value;
    const baseline = createBaselineCandidate(layout);
    const candidate = clonePlacementCandidate(baseline, 'move');
    const candidateBounds = candidate.layout.shapes.values().next().value;
    const candidateChildBounds =
      candidate.layout.children[0].shapes.values().next().value;
    const candidateEdge = candidate.layout.edges.values().next().value;

    assert.ok(originalBounds);
    assert.ok(candidateBounds);
    assert.ok(candidateChildBounds);
    assert.ok(candidateEdge);

    candidateBounds.y += 100;
    candidateEdge[0].y += 100;
    candidateChildBounds.y += 100;

    assert.strictEqual(originalBounds.y, 20);
    assert.strictEqual(layout.edges.values().next().value?.[0].y, 60);
    assert.strictEqual(
      layout.children[0].shapes.values().next().value?.y,
      30
    );
  });

  it('should commit coordinates without replacing shared bounds objects', function() {
    const layout = createCandidateLayout();
    const element = layout.shapes.keys().next().value;

    assert.ok(element);

    const originalBounds = layout.shapes.get(element);
    const candidate = createBaselineCandidate(layout);
    const candidateBounds = candidate.layout.shapes.get(element);

    assert.ok(originalBounds);
    assert.ok(candidateBounds);

    candidateBounds.y = 220;
    commitPlacementCandidate(layout, candidate);

    assert.strictEqual(layout.shapes.get(element), originalBounds);
    assert.strictEqual(originalBounds.y, 220);
  });

  it('should reject any additional hard defect', function() {
    const baseline = {
      hardDefects: [ 0, 1, 0, 0 ],
      spineLoadImbalance: 0,
      vector: []
    };

    assert.strictEqual(introducesHardDefect({
      hardDefects: [ 0, 1, 0, 0 ],
      spineLoadImbalance: 0,
      vector: []
    }, baseline), false);
    assert.strictEqual(introducesHardDefect({
      hardDefects: [ 0, 1, 1, 0 ],
      spineLoadImbalance: 0,
      vector: []
    }, baseline), true);
  });
});

function createCandidateLayout() {
  const process = moddle.create('bpmn:Process', { id: 'Process' });
  const source = moddle.create('bpmn:Task', { id: 'Source' });
  const target = moddle.create('bpmn:Task', { id: 'Target' });
  const flow = moddle.create('bpmn:SequenceFlow', {
    id: 'Flow',
    sourceRef: source,
    targetRef: target
  });
  const childScope = moddle.create('bpmn:SubProcess', { id: 'Child' });
  const childTask = moddle.create('bpmn:Task', { id: 'ChildTask' });
  const layout = createLayout(process);
  const child = createLayout(childScope);

  layout.shapes.set(source, bounds(10, 20, 100, 80));
  layout.edges.set(flow, [
    { x: 110, y: 60 },
    { x: 200, y: 60 }
  ]);
  child.shapes.set(childTask, bounds(20, 30, 100, 80));
  child.emitInParent = true;
  layout.children.push(child);

  return layout;
}
