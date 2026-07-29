import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { BpmnModdle } from 'bpmn-moddle';

import {
  layoutProcessScope
} from '../lib/layout/process/index.js';

describe('ProcessPipeline', function() {

  it('should create complete process geometry', async function() {
    const process = await importProcess('text-annotation.basic.bpmn');
    const flowNodes = process.flowElements.filter(element => {
      return element.$instanceOf('bpmn:FlowNode');
    });
    const sequenceFlows = process.flowElements.filter(element => {
      return element.$instanceOf('bpmn:SequenceFlow');
    });
    const annotation = process.artifacts.find(element => {
      return element.$instanceOf('bpmn:TextAnnotation');
    });
    const association = process.artifacts.find(element => {
      return element.$instanceOf('bpmn:Association');
    });

    const result = layoutProcessScope(process);

    assert.ok(flowNodes.every(element => result.layout.shapes.has(element)));
    assert.ok(sequenceFlows.every(element => result.layout.edges.has(element)));
    assert.ok(result.layout.shapes.has(annotation));
    assert.ok(result.layout.edges.has(association));
    assert.deepStrictEqual(result.warnings, []);
  });


  it('should lay out expanded child scopes through the same interface', async function() {
    const process = await importProcess('sub-process.expanded.bpmn');
    const subProcess = process.flowElements.find(element => {
      return element.$instanceOf('bpmn:SubProcess');
    });

    const result = layoutProcessScope(process, {
      expandedIds: new Set([ subProcess.id ])
    });
    const child = result.layout.children.find(layout => {
      return layout.scope === subProcess;
    });

    assert.ok(result.layout.shapes.has(subProcess));
    assert.strictEqual(child.emitInParent, true);
    assert.ok(subProcess.flowElements
      .filter(element => element.$instanceOf('bpmn:FlowNode'))
      .every(element => child.shapes.has(element)));
    assert.ok(subProcess.flowElements
      .filter(element => element.$instanceOf('bpmn:SequenceFlow'))
      .every(element => child.edges.has(element)));
  });
});

async function importProcess(name) {
  const xml = await readFile(
    new URL(`fixtures/${ name }`, import.meta.url),
    'utf8'
  );
  const { rootElement } = await new BpmnModdle().fromXML(xml);

  return rootElement.rootElements.find(element => {
    return element.$instanceOf('bpmn:Process');
  });
}
