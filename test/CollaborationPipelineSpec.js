import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { BpmnModdle } from 'bpmn-moddle';

import {
  COLLABORATION_LAYOUT_STEPS,
  createCollaborationLayoutContext,
  layoutCollaboration
} from '../lib/layout/collaboration/index.js';

describe('CollaborationPipeline', function() {

  it('should define immutable collaboration phases in lifecycle order', function() {
    assert.ok(Object.isFrozen(COLLABORATION_LAYOUT_STEPS));
    assert.deepStrictEqual(COLLABORATION_LAYOUT_STEPS.map(step => step.name), [
      'validateCollaboration',
      'layoutParticipants',
      'orderParticipants',
      'positionParticipants',
      'compactParticipantRows',
      'routeMessageFlows',
      'placeArtifacts'
    ]);
  });


  it('should create a complete context before the first step', function() {
    const collaboration = createCollaboration();
    const context = createCollaborationLayoutContext(collaboration, {
      steps: COLLABORATION_LAYOUT_STEPS
    });

    assert.deepStrictEqual(Object.keys(context), [
      'collaboration',
      'options',
      'participants',
      'routing',
      'layout',
      'warnings'
    ]);
    assert.strictEqual(context.collaboration, collaboration);
    assert.strictEqual(context.options.steps, COLLABORATION_LAYOUT_STEPS);
    assert.deepStrictEqual(context.participants.layouts, new Map());
    assert.deepStrictEqual(context.participants.order, []);
    assert.deepStrictEqual(context.routing.channelOffsets, new Map());
    assert.strictEqual(context.layout.scope, collaboration);
  });


  it('should run an inserted collaboration step with context', function() {
    const collaboration = createCollaboration();
    let captured;
    const steps = COLLABORATION_LAYOUT_STEPS.flatMap(runStep => {
      if (runStep.name !== 'validateCollaboration') {
        return [ runStep ];
      }

      return [
        runStep,
        function captureValidatedContext(context) {
          captured = context;

          return context;
        }
      ];
    });

    const result = layoutCollaboration(collaboration, { steps });

    assert.strictEqual(captured.collaboration, collaboration);
    assert.strictEqual(result.layout, captured.layout);
  });


  it('should publish participant and message geometry in order', async function() {
    const collaboration = await importCollaboration(
      'collaboration.message-flow-between-pools.bpmn'
    );
    const messageFlow = collaboration.messageFlows[0];
    const observed = new Map();
    const steps = COLLABORATION_LAYOUT_STEPS.flatMap(runStep => [
      runStep,
      function capturePhaseState(context) {
        observed.set(runStep.name, {
          participants: collaboration.participants.filter(participant => {
            return context.layout.shapes.has(participant);
          }).length,
          participantLayouts: context.participants.layouts.size,
          order: context.participants.order.length,
          hasMessageFlow: context.layout.edges.has(messageFlow)
        });

        return context;
      }
    ]);

    layoutCollaboration(collaboration, { steps });

    assert.deepStrictEqual(observed.get('validateCollaboration'), {
      participants: 0,
      participantLayouts: 0,
      order: 0,
      hasMessageFlow: false
    });
    assert.deepStrictEqual(observed.get('layoutParticipants'), {
      participants: 2,
      participantLayouts: 2,
      order: 0,
      hasMessageFlow: false
    });
    assert.deepStrictEqual(observed.get('orderParticipants'), {
      participants: 2,
      participantLayouts: 2,
      order: 2,
      hasMessageFlow: false
    });
    assert.deepStrictEqual(observed.get('compactParticipantRows'), {
      participants: 2,
      participantLayouts: 2,
      order: 2,
      hasMessageFlow: false
    });
    assert.deepStrictEqual(observed.get('routeMessageFlows'), {
      participants: 2,
      participantLayouts: 2,
      order: 2,
      hasMessageFlow: true
    });
  });


  it('should publish collaboration artifacts only in the final phase', async function() {
    const collaboration = await importCollaboration(
      'artifact.collaboration-association.bpmn'
    );
    const annotation = collaboration.artifacts.find(element => {
      return element.$instanceOf('bpmn:TextAnnotation');
    });
    const association = collaboration.artifacts.find(element => {
      return element.$instanceOf('bpmn:Association');
    });
    const observed = {};
    const steps = COLLABORATION_LAYOUT_STEPS.flatMap(runStep => [
      runStep,
      function captureArtifactBoundary(context) {
        if (runStep.name === 'routeMessageFlows') {
          observed.beforeArtifacts = {
            shape: context.layout.shapes.has(annotation),
            edge: context.layout.edges.has(association)
          };
        }

        if (runStep.name === 'placeArtifacts') {
          observed.afterArtifacts = {
            shape: context.layout.shapes.has(annotation),
            edge: context.layout.edges.has(association)
          };
        }

        return context;
      }
    ]);

    layoutCollaboration(collaboration, { steps });

    assert.deepStrictEqual(observed, {
      beforeArtifacts: {
        shape: false,
        edge: false
      },
      afterArtifacts: {
        shape: true,
        edge: true
      }
    });
  });
});

function createCollaboration() {
  return {
    id: 'Collaboration_1',
    participants: [],
    messageFlows: [],
    artifacts: []
  };
}

async function importCollaboration(name) {
  const xml = await readFile(
    new URL(`fixtures/${ name }`, import.meta.url),
    'utf8'
  );
  const { rootElement } = await new BpmnModdle().fromXML(xml);

  return rootElement.rootElements.find(element => {
    return element.$instanceOf('bpmn:Collaboration');
  });
}
