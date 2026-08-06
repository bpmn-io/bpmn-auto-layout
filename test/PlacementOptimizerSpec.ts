import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  bounds,
  createLayout
} from '../lib/layout/geometry/index.js';
import {
  countLayoutShapeOverlaps,
  introducesHardDefect,
  scoreCompleteLayout
} from '../lib/layout/process/optimization/LayoutScoring.js';
import {
  collectPrimaryEdgeOptions
} from '../lib/layout/process/steps/optimizePrimaryPaths.js';
import {
  optimizeCollaborationLayout
} from '../lib/layout/collaboration/steps/optimizeCollaborationLayout.js';
import {
  clonePlacementCandidate,
  commitPlacementCandidate,
  createBaselineCandidate
} from '../lib/layout/process/optimization/PlacementCandidate.js';

import type {
  CollaborationLayoutContext,
  SemanticPolicy
} from '../lib/layout/Types.js';

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

  it('should count candidate shape overlaps before routing', function() {
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const first = moddle.create('bpmn:Task', { id: 'First' });
    const second = moddle.create('bpmn:Task', { id: 'Second' });
    const layout = createLayout(process);

    layout.shapes.set(first, bounds(0, 0, 100, 80));
    layout.shapes.set(second, bounds(200, 0, 100, 80));

    const baseline = createBaselineCandidate(layout);
    const candidate = clonePlacementCandidate(baseline, 'overlap');
    const shapes = [ ...candidate.layout.shapes.values() ];

    assert.strictEqual(countLayoutShapeOverlaps(baseline.layout), 0);

    shapes[1].x = shapes[0].x;
    shapes[1].y = shapes[0].y;

    assert.strictEqual(countLayoutShapeOverlaps(candidate.layout), 1);
  });

  it('should score all crossings in emitted collaboration geometry', function() {
    const collaboration = moddle.create('bpmn:Collaboration', {
      id: 'Collaboration'
    });
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const source = moddle.create('bpmn:Task', { id: 'Source' });
    const target = moddle.create('bpmn:Task', { id: 'Target' });
    const childSource = moddle.create('bpmn:Task', { id: 'ChildSource' });
    const childTarget = moddle.create('bpmn:Task', { id: 'ChildTarget' });
    const messageFlow = moddle.create('bpmn:MessageFlow', {
      id: 'MessageFlow',
      sourceRef: source,
      targetRef: target
    });
    const sequenceFlow = moddle.create('bpmn:SequenceFlow', {
      id: 'SequenceFlow',
      sourceRef: childSource,
      targetRef: childTarget
    });
    const association = moddle.create('bpmn:Association', {
      id: 'Association',
      sourceRef: childSource,
      targetRef: childTarget
    });
    const layout = createLayout(collaboration);
    const child = createLayout(process);

    layout.shapes.set(source, bounds(0, 40, 20, 20));
    layout.shapes.set(target, bounds(80, 40, 20, 20));
    layout.edges.set(messageFlow, [
      { x: 20, y: 50 },
      { x: 80, y: 50 }
    ]);
    child.shapes.set(childSource, bounds(40, 0, 20, 20));
    child.shapes.set(childTarget, bounds(40, 80, 20, 20));
    child.edges.set(sequenceFlow, [
      { x: 50, y: 20 },
      { x: 50, y: 80 }
    ]);
    child.edges.set(association, [
      { x: 30, y: 20 },
      { x: 30, y: 80 }
    ]);
    child.emitInParent = true;
    layout.children.push(child);

    assert.strictEqual(scoreCompleteLayout(layout).crossings, 2);
  });

  it('should not count expanded containment as a shape overlap', function() {
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const subProcess = moddle.create('bpmn:SubProcess', { id: 'SubProcess' });
    const task = moddle.create('bpmn:Task', { id: 'Task' });
    const layout = createLayout(process);
    const child = createLayout(subProcess);

    layout.shapes.set(subProcess, bounds(0, 0, 200, 160));
    child.shapes.set(task, bounds(50, 40, 100, 80));
    child.emitInParent = true;
    layout.children.push(child);

    assert.strictEqual(scoreCompleteLayout(layout).hardDefects[0], 0);
  });

  it('should not count opposing endpoint stubs as an edge overlap', function() {
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const source = moddle.create('bpmn:Task', { id: 'Source' });
    const shared = moddle.create('bpmn:Task', { id: 'Shared' });
    const target = moddle.create('bpmn:Task', { id: 'Target' });
    const incoming = moddle.create('bpmn:SequenceFlow', {
      id: 'Incoming',
      sourceRef: source,
      targetRef: shared
    });
    const outgoing = moddle.create('bpmn:SequenceFlow', {
      id: 'Outgoing',
      sourceRef: shared,
      targetRef: target
    });
    const layout = createLayout(process);

    layout.shapes.set(source, bounds(0, 0, 100, 80));
    layout.shapes.set(shared, bounds(200, 0, 100, 80));
    layout.shapes.set(target, bounds(400, 0, 100, 80));
    layout.edges.set(incoming, [
      { x: 100, y: 40 },
      { x: 320, y: 40 },
      { x: 300, y: 40 }
    ]);
    layout.edges.set(outgoing, [
      { x: 300, y: 40 },
      { x: 320, y: 40 },
      { x: 400, y: 40 }
    ]);

    assert.strictEqual(scoreCompleteLayout(layout).hardDefects.at(-1), 0);
  });

  it('should count opposing overlaps away from a shared docking stub', function() {
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const source = moddle.create('bpmn:Task', { id: 'Source' });
    const shared = moddle.create('bpmn:Task', { id: 'Shared' });
    const target = moddle.create('bpmn:Task', { id: 'Target' });
    const incoming = moddle.create('bpmn:SequenceFlow', {
      id: 'Incoming',
      sourceRef: source,
      targetRef: shared
    });
    const outgoing = moddle.create('bpmn:SequenceFlow', {
      id: 'Outgoing',
      sourceRef: shared,
      targetRef: target
    });
    const layout = createLayout(process);

    layout.shapes.set(source, bounds(0, 0, 100, 80));
    layout.shapes.set(shared, bounds(200, 0, 100, 80));
    layout.shapes.set(target, bounds(400, 0, 100, 80));
    layout.edges.set(incoming, [
      { x: 100, y: 40 },
      { x: 100, y: 120 },
      { x: 300, y: 120 },
      { x: 300, y: 40 }
    ]);
    layout.edges.set(outgoing, [
      { x: 300, y: 40 },
      { x: 320, y: 40 },
      { x: 320, y: 120 },
      { x: 100, y: 120 },
      { x: 400, y: 40 }
    ]);

    assert.strictEqual(scoreCompleteLayout(layout).hardDefects.at(-1), 1);
  });

  it('should replay primary paths against complete collaboration geometry', function() {
    const collaboration = moddle.create('bpmn:Collaboration', {
      id: 'Collaboration'
    });
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const secondProcess = moddle.create('bpmn:Process', {
      id: 'SecondProcess'
    });
    const gateway = moddle.create('bpmn:InclusiveGateway', { id: 'Gateway' });
    const firstTarget = moddle.create('bpmn:Task', { id: 'FirstTarget' });
    const secondTarget = moddle.create('bpmn:Task', { id: 'SecondTarget' });
    const firstFlow = moddle.create('bpmn:SequenceFlow', {
      id: 'Flow_A',
      sourceRef: gateway,
      targetRef: firstTarget
    });
    const secondFlow = moddle.create('bpmn:SequenceFlow', {
      id: 'Flow_B',
      sourceRef: gateway,
      targetRef: secondTarget
    });
    const baseline = createCompleteScoringLayout(false);
    const improved = createCompleteScoringLayout(true);
    const policy = createSemanticPolicy(firstFlow, secondFlow);

    addInclusiveDecision(policy, 'Second');
    addInclusiveDecision(policy, 'Third');

    let replayedWithoutOptimization = false;
    const context: CollaborationLayoutContext = {
      collaboration,
      layout: baseline,
      options: {
        expandedIds: new Set(),
        optimizeCollaboration: true,
        optimizePrimaryPaths: true,
        primaryEdgeOverrides: new Map(),
        layoutCollaboration: (_collaboration, options = {}) => {
          replayedWithoutOptimization =
            options.optimizeCollaboration === false &&
            options.optimizePrimaryPaths === false;
          const selected = options.primaryEdgeOverrides?.get(gateway);

          return {
            layout: selected === secondFlow ? improved : baseline,
            primaryPathDiagnostics: [],
            semantics: {
              policy: null,
              ranks: null
            },
            warnings: []
          };
        }
      },
      participants: {
        anchorPositioned: new Set(),
        expandable: new Set(),
        layouts: new Map(),
        order: [],
        semantics: new Map([
          [ process, { policy, ranks: { rank: new Map() } } ],
          [ secondProcess, { policy: null, ranks: null } ]
        ])
      },
      primaryPathDiagnostics: [],
      routing: {
        channelOffsets: new Map(),
        endpointDirections: new Map()
      },
      warnings: []
    };

    const optimized = optimizeCollaborationLayout(context);

    assert.deepStrictEqual(
      scoreCompleteLayout(improved).hardDefects,
      scoreCompleteLayout(baseline).hardDefects
    );
    assert.strictEqual(scoreCompleteLayout(baseline).crossings, 1);
    assert.strictEqual(scoreCompleteLayout(improved).crossings, 0);
    assert.strictEqual(optimized.layout, improved);
    assert.strictEqual(replayedWithoutOptimization, true);
  });

  it('should collect alternatives that share a downstream convergence', function() {
    const gateway = moddle.create('bpmn:ExclusiveGateway', { id: 'Gateway' });
    const firstTarget = moddle.create('bpmn:Task', { id: 'FirstTarget' });
    const secondTarget = moddle.create('bpmn:Task', { id: 'SecondTarget' });
    const join = moddle.create('bpmn:ExclusiveGateway', { id: 'Join' });
    const firstFlow = moddle.create('bpmn:SequenceFlow', {
      id: 'Flow_A',
      sourceRef: gateway,
      targetRef: firstTarget
    });
    const secondFlow = moddle.create('bpmn:SequenceFlow', {
      id: 'Flow_B',
      sourceRef: gateway,
      targetRef: secondTarget
    });
    const firstJoin = moddle.create('bpmn:SequenceFlow', {
      id: 'Join_A',
      sourceRef: firstTarget,
      targetRef: join
    });
    const secondJoin = moddle.create('bpmn:SequenceFlow', {
      id: 'Join_B',
      sourceRef: secondTarget,
      targetRef: join
    });
    const policy = createSemanticPolicy(firstFlow, secondFlow);

    policy.graphEdges.push(firstJoin, secondJoin);

    assert.deepStrictEqual(
      collectPrimaryEdgeOptions(policy).map(decision => decision.source.id),
      [ 'Gateway' ]
    );
  });
});

function createCompleteScoringLayout(avoidCrossing: boolean) {
  const collaboration = moddle.create('bpmn:Collaboration', {
    id: 'ScoringCollaboration'
  });
  const process = moddle.create('bpmn:Process', { id: 'ScoringProcess' });
  const source = moddle.create('bpmn:Task', { id: 'Source' });
  const target = moddle.create('bpmn:Task', { id: 'Target' });
  const childSource = moddle.create('bpmn:Task', { id: 'ChildSource' });
  const childTarget = moddle.create('bpmn:Task', { id: 'ChildTarget' });
  const messageFlow = moddle.create('bpmn:MessageFlow', {
    id: 'MessageFlow',
    sourceRef: source,
    targetRef: target
  });
  const sequenceFlow = moddle.create('bpmn:SequenceFlow', {
    id: 'SequenceFlow',
    sourceRef: childSource,
    targetRef: childTarget
  });
  const layout = createLayout(collaboration);
  const child = createLayout(process);

  layout.shapes.set(source, bounds(0, 40, 20, 20));
  layout.shapes.set(target, bounds(80, 40, 20, 20));
  layout.edges.set(messageFlow, [
    { x: 20, y: 50 },
    { x: 80, y: 50 }
  ]);
  child.shapes.set(childSource, bounds(40, 0, 20, 20));
  child.shapes.set(childTarget, bounds(40, 80, 20, 20));
  child.edges.set(sequenceFlow, avoidCrossing ? [
    { x: 50, y: 20 },
    { x: 50, y: 30 },
    { x: -10, y: 30 },
    { x: -10, y: 70 },
    { x: 50, y: 70 },
    { x: 50, y: 80 }
  ] : [
    { x: 50, y: 20 },
    { x: 50, y: 80 }
  ]);
  child.emitInParent = true;
  layout.children.push(child);

  return layout;
}

function createSemanticPolicy(
    firstFlow: ReturnType<typeof moddle.create>,
    secondFlow: ReturnType<typeof moddle.create>
): SemanticPolicy {
  return {
    backEdges: new Set(),
    bands: new Map(),
    boundaryBayEdges: new Set(),
    compactFlowRegions: [],
    components: new Map(),
    edgeOrder: new Map([
      [ firstFlow, 0 ],
      [ secondFlow, 1 ]
    ]),
    feedbackRegions: [],
    flowNodeDocumentIndex: new Map(),
    graphEdges: [ firstFlow, secondFlow ],
    rankWeights: new Map(),
    spine: new Set([ firstFlow ]),
    straightEdges: new Set()
  };
}

function addInclusiveDecision(
    policy: SemanticPolicy,
    id: string
): void {
  const gateway = moddle.create('bpmn:InclusiveGateway', {
    id: `${ id }Gateway`
  });
  const firstTarget = moddle.create('bpmn:Task', {
    id: `${ id }FirstTarget`
  });
  const secondTarget = moddle.create('bpmn:Task', {
    id: `${ id }SecondTarget`
  });
  const firstFlow = moddle.create('bpmn:SequenceFlow', {
    id: `${ id }FlowA`,
    sourceRef: gateway,
    targetRef: firstTarget
  });
  const secondFlow = moddle.create('bpmn:SequenceFlow', {
    id: `${ id }FlowB`,
    sourceRef: gateway,
    targetRef: secondTarget
  });

  policy.graphEdges.push(firstFlow, secondFlow);
  policy.spine.add(firstFlow);
  policy.edgeOrder.set(firstFlow, 0);
  policy.edgeOrder.set(secondFlow, 1);
}

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
