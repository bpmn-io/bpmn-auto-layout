import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { BpmnModdle } from 'bpmn-moddle';

import {
  layoutCollaboration
} from '../lib/layout/collaboration/index.js';

describe('CollaborationPipeline', function() {

  it('should create participant and message-flow geometry', async function() {
    const collaboration = await importCollaboration(
      'collaboration.message-flow-between-pools.bpmn'
    );

    const result = layoutCollaboration(collaboration);

    assert.ok(collaboration.participants.every(participant => {
      return result.layout.shapes.has(participant);
    }));
    assert.ok(collaboration.messageFlows.every(messageFlow => {
      return result.layout.edges.has(messageFlow);
    }));
    assert.deepStrictEqual(result.warnings, []);
  });


  it('should create collaboration artifact geometry', async function() {
    const collaboration = await importCollaboration(
      'artifact.collaboration-association.bpmn'
    );
    const annotation = collaboration.artifacts.find(element => {
      return element.$instanceOf('bpmn:TextAnnotation');
    });
    const association = collaboration.artifacts.find(element => {
      return element.$instanceOf('bpmn:Association');
    });

    const result = layoutCollaboration(collaboration);

    assert.ok(result.layout.shapes.has(annotation));
    assert.ok(result.layout.edges.has(association));
    assert.deepStrictEqual(result.warnings, []);
  });
});

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
