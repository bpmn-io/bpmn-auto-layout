import assert from 'node:assert';

import {
  COLLABORATION_LAYOUT_STEPS,
  createCollaborationLayoutContext,
  layoutCollaboration
} from '../lib/layout/collaboration/index.js';

describe('CollaborationPipeline', function() {

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
});

function createCollaboration() {
  return {
    id: 'Collaboration_1',
    participants: [],
    messageFlows: [],
    artifacts: []
  };
}
