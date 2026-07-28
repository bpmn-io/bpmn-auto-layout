import assert from 'node:assert';

import {
  createProcessLayoutContext,
  layoutProcessScope,
  PROCESS_LAYOUT_STEPS
} from '../lib/layout/ProcessLayoutPipeline.js';

describe('ProcessLayoutPipeline', function() {

  it('should create a complete process-layout context before the first step', function() {
    const process = createProcess();

    const context = createProcessLayoutContext(process);

    assert.strictEqual(context.scope, process);
    assert.deepStrictEqual(Object.keys(context), [
      'scope',
      'options',
      'elements',
      'graph',
      'semantics',
      'layout',
      'warnings'
    ]);
    assert.deepStrictEqual(context.elements.records, []);
    assert.deepStrictEqual(context.graph.records, []);
    assert.strictEqual(context.semantics.policy, null);
    assert.strictEqual(context.semantics.ranks, null);
    assert.strictEqual(context.layout.scope, process);
  });


  it('should run an inserted process-layout step with pipeline context', function() {
    const process = createProcess();
    let captured;
    const steps = PROCESS_LAYOUT_STEPS.flatMap(runStep => {
      if (runStep.name !== 'extractElements') {
        return [ runStep ];
      }

      return [
        runStep,
        function captureExtractedLayout(context) {
          captured = context.layout;

          return context;
        }
      ];
    });

    const result = layoutProcessScope(process, { steps });

    assert.strictEqual(captured, result.layout);
    assert.strictEqual(result.layout.scope, process);
  });
});

function createProcess() {
  return {
    id: 'Process_1',
    flowElements: [],
    artifacts: [],
    $instanceOf(type) {
      return type === 'bpmn:Process';
    }
  };
}
