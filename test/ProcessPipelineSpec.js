import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { BpmnModdle } from 'bpmn-moddle';

import {
  createProcessLayoutContext,
  layoutProcessScope,
  PROCESS_LAYOUT_STEPS
} from '../lib/layout/process/index.js';

describe('ProcessPipeline', function() {

  it('should define immutable process phases in lifecycle order', function() {
    assert.ok(Object.isFrozen(PROCESS_LAYOUT_STEPS));
    assert.deepStrictEqual(PROCESS_LAYOUT_STEPS.map(step => step.name), [
      'extractElements',
      'layoutChildScopes',
      'validateScope',
      'analyzeSemantics',
      'placeFlowNodes',
      'placeExpandedChildren',
      'routeSequenceFlows',
      'placeEventSubProcesses',
      'placeArtifacts',
      'placeGroups'
    ]);
  });


  it('should create a complete process-layout context before the first step', function() {
    const process = createProcess();

    const context = createProcessLayoutContext(process, {
      steps: PROCESS_LAYOUT_STEPS
    });

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
    assert.strictEqual(context.options.steps, PROCESS_LAYOUT_STEPS);
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


  it('should publish geometry only in its owning phase', async function() {
    const process = await importProcess('text-annotation.basic.bpmn');
    const annotation = process.artifacts.find(element => {
      return element.$instanceOf('bpmn:TextAnnotation');
    });
    const association = process.artifacts.find(element => {
      return element.$instanceOf('bpmn:Association');
    });
    const sequenceFlows = process.flowElements.filter(element => {
      return element.$instanceOf('bpmn:SequenceFlow');
    });
    const observed = new Map();
    const steps = PROCESS_LAYOUT_STEPS.flatMap(runStep => [
      runStep,
      function capturePhaseState(context) {
        observed.set(runStep.name, {
          graphNodes: context.graph.nodes.length,
          hasSemantics: Boolean(context.semantics.policy),
          hasGraphShapes: context.graph.nodes.length > 0 &&
            context.graph.nodes.every(element => {
              return context.layout.shapes.has(element);
            }),
          hasAnnotationShape: context.layout.shapes.has(annotation),
          hasSequenceFlows: sequenceFlows.every(flow => {
            return context.layout.edges.has(flow);
          }),
          hasAssociation: context.layout.edges.has(association)
        });

        return context;
      }
    ]);

    layoutProcessScope(process, { steps });

    assert.deepStrictEqual(observed.get('extractElements'), {
      graphNodes: 0,
      hasSemantics: false,
      hasGraphShapes: false,
      hasAnnotationShape: false,
      hasSequenceFlows: false,
      hasAssociation: false
    });
    assert.deepStrictEqual(observed.get('analyzeSemantics'), {
      graphNodes: 3,
      hasSemantics: true,
      hasGraphShapes: false,
      hasAnnotationShape: false,
      hasSequenceFlows: false,
      hasAssociation: false
    });
    assert.deepStrictEqual(observed.get('placeFlowNodes'), {
      graphNodes: 3,
      hasSemantics: true,
      hasGraphShapes: true,
      hasAnnotationShape: false,
      hasSequenceFlows: false,
      hasAssociation: false
    });
    assert.deepStrictEqual(observed.get('routeSequenceFlows'), {
      graphNodes: 3,
      hasSemantics: true,
      hasGraphShapes: true,
      hasAnnotationShape: false,
      hasSequenceFlows: true,
      hasAssociation: false
    });
    assert.deepStrictEqual(observed.get('placeArtifacts'), {
      graphNodes: 3,
      hasSemantics: true,
      hasGraphShapes: true,
      hasAnnotationShape: true,
      hasSequenceFlows: true,
      hasAssociation: true
    });
  });


  it('should propagate phases and publish expanded child geometry', async function() {
    const process = await importProcess('sub-process.expanded.bpmn');
    const subProcess = process.flowElements.find(element => {
      return element.$instanceOf('bpmn:SubProcess');
    });
    const analyzedScopes = [];
    const publication = {};
    const steps = PROCESS_LAYOUT_STEPS.flatMap(runStep => [
      runStep,
      function captureChildBoundary(context) {
        if (runStep.name === 'analyzeSemantics') {
          analyzedScopes.push(context.scope.id);
        }

        if (context.scope === process) {
          const record = context.placement.recordsByElement.get(subProcess);

          if (runStep.name === 'layoutChildScopes') {
            publication.beforeParentPlacement = record.child.emitInParent;
          }

          if (runStep.name === 'placeExpandedChildren') {
            publication.afterParentPlacement = record.child.emitInParent;
          }
        }

        return context;
      }
    ]);

    layoutProcessScope(process, {
      expandedIds: new Set([ subProcess.id ]),
      steps
    });

    assert.deepStrictEqual(analyzedScopes, [ subProcess.id, process.id ]);
    assert.deepStrictEqual(publication, {
      beforeParentPlacement: false,
      afterParentPlacement: true
    });
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

async function importProcess(name) {
  const xml = await importFixture(name);
  const { rootElement } = await new BpmnModdle().fromXML(xml);

  return rootElement.rootElements.find(element => {
    return element.$instanceOf('bpmn:Process');
  });
}
