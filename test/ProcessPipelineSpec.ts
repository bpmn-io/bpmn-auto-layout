import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  layoutProcessScope
} from '../lib/layout/process/index.js';
import { isBpmnType } from '../lib/layout/bpmn/Types.js';

import type { BpmnElementFor } from '../lib/layout/bpmn/Types.js';

describe('ProcessPipeline', function() {

  it('should create complete process geometry', async function() {
    const process = await importProcess('text-annotation.basic.bpmn');
    const flowElements = getRequired(process.flowElements);
    const flowNodes = flowElements.filter(element => {
      return isBpmnType(element, 'bpmn:FlowNode');
    });
    const sequenceFlows = flowElements.filter(element => {
      return isBpmnType(element, 'bpmn:SequenceFlow');
    });
    const artifacts = getRequired(process.artifacts);
    const annotation = getRequired(artifacts.find(element => {
      return isBpmnType(element, 'bpmn:TextAnnotation');
    }));
    const association = getRequired(artifacts.find(element => {
      return isBpmnType(element, 'bpmn:Association');
    }));

    const result = layoutProcessScope(process);

    assert.ok(flowNodes.every(element => result.layout.shapes.has(element)));
    assert.ok(sequenceFlows.every(element => result.layout.edges.has(element)));
    assert.ok(result.layout.shapes.has(annotation));
    assert.ok(result.layout.edges.has(association));
    assert.deepStrictEqual(result.warnings, []);
  });


  it('should lay out expanded child scopes through the same interface', async function() {
    const process = await importProcess('sub-process.expanded.bpmn');
    const subProcess = getRequired(getRequired(process.flowElements).find(element => {
      return isBpmnType(element, 'bpmn:SubProcess');
    }));

    const subProcessId = getRequired(subProcess.id);
    const result = layoutProcessScope(process, {
      expandedIds: new Set([ subProcessId ])
    });
    const child = getRequired(result.layout.children.find(layout => {
      return layout.scope === subProcess;
    }));

    assert.ok(result.layout.shapes.has(subProcess));
    assert.strictEqual(child.emitInParent, true);
    assert.ok(getRequired(subProcess.flowElements)
      .filter(element => isBpmnType(element, 'bpmn:FlowNode'))
      .every(element => child.shapes.has(element)));
    assert.ok(getRequired(subProcess.flowElements)
      .filter(element => isBpmnType(element, 'bpmn:SequenceFlow'))
      .every(element => child.edges.has(element)));
  });
});

async function importProcess(name: string): Promise<BpmnElementFor<'bpmn:Process'>> {
  const xml = await readFile(
    new URL(`fixtures/${ name }`, import.meta.url),
    'utf8'
  );
  const { rootElement } = await new BpmnModdle().fromXML(xml);

  return getRequired(rootElement.rootElements?.find(element => {
    return isBpmnType(element, 'bpmn:Process');
  }));
}

function getRequired<Value>(value: Value | null | undefined): Value {
  if (value === null || value === undefined) {
    throw new Error('Expected a value.');
  }

  return value;
}
