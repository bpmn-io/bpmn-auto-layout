import assert from 'node:assert';
import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import { placeArtifacts } from '../lib/layout/artifacts/index.js';
import { createLayout } from '../lib/layout/geometry/LayoutState.js';

import type {
  BpmnElement,
  Bounds,
  LayoutRecord
} from '../lib/layout/Types.js';

const moddle = new BpmnModdle();

describe('ArtifactPlacement', function() {

  it('should place and route an artifact through the module interface', function() {
    const { annotation, association, layout } = layoutAnnotation();

    assert.deepStrictEqual(layout.shapes.get(annotation), {
      x: 0,
      y: -80,
      width: 100,
      height: 40
    });
    assert.deepStrictEqual(layout.edges.get(association), [
      { x: 50, y: 0 },
      { x: 50, y: -40 }
    ]);
  });


  it('should select the next valid placement when geometry is occupied', function() {
    const { annotation, association, layout } = layoutAnnotation({
      x: 0,
      y: -60,
      width: 100,
      height: 40
    });

    assert.deepStrictEqual(layout.shapes.get(annotation), {
      x: 0,
      y: 120,
      width: 100,
      height: 40
    });
    assert.deepStrictEqual(layout.edges.get(association), [
      { x: 50, y: 80 },
      { x: 50, y: 120 }
    ]);
  });


  it('should prefer participant exterior over a crossing-free interior', function() {
    const participant = moddle.create('bpmn:Participant', { id: 'Participant' });
    const task = moddle.create('bpmn:Task', { id: 'Task' });
    const annotation = moddle.create('bpmn:TextAnnotation', { id: 'Annotation' });
    const association = moddle.create('bpmn:Association', {
      id: 'Association',
      sourceRef: task,
      targetRef: annotation
    });
    const crossingFlow = moddle.create('bpmn:SequenceFlow', { id: 'Flow' });
    const layout = createLayout(moddle.create('bpmn:Process', { id: 'Process' }));

    layout.shapes.set(participant, {
      x: 0,
      y: 0,
      width: 300,
      height: 200
    });
    layout.shapes.set(task, {
      x: 100,
      y: 60,
      width: 100,
      height: 80
    });
    layout.edges.set(crossingFlow, [
      { x: 0, y: -10 },
      { x: 300, y: -10 },
      { x: 300, y: 170 },
      { x: 0, y: 170 }
    ]);

    placeArtifacts({
      records: [ artifactRecord(annotation) ],
      associations: [ association ],
      layout,
      avoidParticipantInterior: true,
      preferParticipantSides: false
    });

    assert.deepStrictEqual(layout.shapes.get(annotation), {
      x: 80,
      y: 200,
      width: 140,
      height: 40
    });
  });
});

function layoutAnnotation(blockerBounds?: Bounds) {
  const task = moddle.create('bpmn:Task', { id: 'Task' });
  const annotation = moddle.create('bpmn:TextAnnotation', { id: 'Annotation' });
  const association = moddle.create('bpmn:Association', {
    id: 'Association',
    sourceRef: task,
    targetRef: annotation
  });
  const layout = createLayout(moddle.create('bpmn:Process', { id: 'Process' }));

  layout.shapes.set(task, { x: 0, y: 0, width: 100, height: 80 });

  if (blockerBounds) {
    layout.shapes.set(
      moddle.create('bpmn:Task', { id: 'Blocker' }),
      blockerBounds
    );
  }

  placeArtifacts({
    records: [ artifactRecord(annotation) ],
    associations: [ association ],
    layout
  });

  return {
    annotation,
    association,
    layout
  };
}

function artifactRecord(element: BpmnElement): LayoutRecord {
  return {
    element,
    index: 0,
    size: { width: 100, height: 40 },
    isBoundary: false,
    isArtifact: true,
    expanded: false,
    child: null
  };
}
