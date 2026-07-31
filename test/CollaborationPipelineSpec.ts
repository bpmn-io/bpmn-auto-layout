import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  layoutCollaboration
} from '../lib/layout/collaboration/index.js';
import { isBpmnType } from '../lib/layout/bpmn/Types.js';

import type { BpmnElementFor } from '../lib/layout/bpmn/Types.js';

describe('CollaborationPipeline', function() {

  it('should create participant and message-flow geometry', async function() {
    const collaboration = await importCollaboration(
      'collaboration.message-flow-between-pools.bpmn'
    );

    const result = layoutCollaboration(collaboration);

    assert.ok((collaboration.participants || []).every(participant => {
      return result.layout.shapes.has(participant);
    }));
    assert.ok((collaboration.messageFlows || []).every(messageFlow => {
      return result.layout.edges.has(messageFlow);
    }));
    assert.deepStrictEqual(result.warnings, []);
  });


  it('should create collaboration artifact geometry', async function() {
    const collaboration = await importCollaboration(
      'artifact.collaboration-association.bpmn'
    );
    const annotation = getRequired((collaboration.artifacts || []).find(element => {
      return isBpmnType(element, 'bpmn:TextAnnotation');
    }));
    const association = getRequired((collaboration.artifacts || []).find(element => {
      return isBpmnType(element, 'bpmn:Association');
    }));

    const result = layoutCollaboration(collaboration);

    assert.ok(result.layout.shapes.has(annotation));
    assert.ok(result.layout.edges.has(association));
    assert.deepStrictEqual(result.warnings, []);
  });
});

async function importCollaboration(
    name: string
): Promise<BpmnElementFor<'bpmn:Collaboration'>> {
  const xml = await readFile(
    new URL(`fixtures/${ name }`, import.meta.url),
    'utf8'
  );
  const { rootElement } = await new BpmnModdle().fromXML(xml);

  return getRequired(rootElement.rootElements?.find(element => {
    return isBpmnType(element, 'bpmn:Collaboration');
  }));
}

function getRequired<Value>(value: Value | null | undefined): Value {
  if (value === null || value === undefined) {
    throw new Error('Expected a value.');
  }

  return value;
}
