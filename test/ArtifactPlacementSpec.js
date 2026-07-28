import assert from 'node:assert';

import { placeArtifacts } from '../lib/layout/artifacts/index.js';
import { createLayout } from '../lib/layout/geometry/LayoutState.js';

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
    const participant = element('Participant', 'bpmn:Participant');
    const task = element('Task', 'bpmn:Task', 'bpmn:Activity');
    const annotation = element('Annotation', 'bpmn:TextAnnotation');
    const association = {
      ...element('Association', 'bpmn:Association'),
      sourceRef: task,
      targetRef: annotation
    };
    const crossingFlow = element('Flow', 'bpmn:SequenceFlow');
    const layout = createLayout({});

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
      records: [ {
        element: annotation,
        index: 0,
        isArtifact: true
      } ],
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

function layoutAnnotation(blockerBounds) {
  const task = element('Task', 'bpmn:Task', 'bpmn:Activity');
  const annotation = element('Annotation', 'bpmn:TextAnnotation');
  const association = {
    ...element('Association', 'bpmn:Association'),
    sourceRef: task,
    targetRef: annotation
  };
  const layout = createLayout({});

  layout.shapes.set(task, { x: 0, y: 0, width: 100, height: 80 });

  if (blockerBounds) {
    layout.shapes.set(
      element('Blocker', 'bpmn:Task', 'bpmn:Activity'),
      blockerBounds
    );
  }

  placeArtifacts({
    records: [ {
      element: annotation,
      index: 0,
      isArtifact: true
    } ],
    associations: [ association ],
    layout
  });

  return {
    annotation,
    association,
    layout
  };
}

function element(id, ...types) {
  return {
    id,
    $instanceOf(candidate) {
      return types.includes(candidate);
    }
  };
}
