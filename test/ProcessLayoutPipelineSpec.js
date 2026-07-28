import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { BpmnModdle } from 'bpmn-moddle';

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
      'placement',
      'layout',
      'warnings'
    ]);
    assert.deepStrictEqual(context.placement.records, []);
    assert.deepStrictEqual(context.graph.nodes, []);
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


  it('should finish semantic mutations before placement', async function() {
    const xml = await importFixture('boundary-event.multiple.bpmn');
    const { rootElement } = await new BpmnModdle().fromXML(xml);
    const process = rootElement.rootElements.find(element => {
      return element.$instanceOf('bpmn:Process');
    });
    let analyzed;
    let completed;
    const steps = PROCESS_LAYOUT_STEPS.flatMap(runStep => {
      if (runStep.name === 'analyzeSemantics') {
        return [
          runStep,
          function captureAnalyzedSemantics(context) {
            analyzed = {
              semantics: context.semantics,
              bands: new Map(context.semantics.policy.bands),
              ranks: new Map(context.semantics.ranks.rank),
              backEdges: new Set(context.semantics.policy.backEdges),
              boundaryBayEdges: new Set(context.semantics.policy.boundaryBayEdges)
            };

            assert.ok([ ...analyzed.bands.values() ].some(Boolean));
            assert.ok(context.graph.nodes.every(element => {
              return context.placement.recordsByElement.has(element);
            }));

            return context;
          }
        ];
      }

      if (runStep.name === 'placeGroups') {
        return [
          runStep,
          function captureCompletedSemantics(context) {
            completed = context.semantics;

            return context;
          }
        ];
      }

      return [ runStep ];
    });

    layoutProcessScope(process, { steps });

    assert.strictEqual(completed, analyzed.semantics);
    assert.deepStrictEqual(completed.policy.bands, analyzed.bands);
    assert.deepStrictEqual(completed.ranks.rank, analyzed.ranks);
    assert.deepStrictEqual(completed.policy.backEdges, analyzed.backEdges);
    assert.deepStrictEqual(
      completed.policy.boundaryBayEdges,
      analyzed.boundaryBayEdges
    );
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

async function importFixture(name) {
  return readFile(new URL(`fixtures/${ name }`, import.meta.url), 'utf8');
}
