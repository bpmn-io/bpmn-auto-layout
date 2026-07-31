import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  routeMessageFlow
} from '../lib/layout/collaboration/routing/MessageFlowRouting.js';

const moddle = new BpmnModdle();

describe('MessageFlowRouting', function() {

  it('should route participant endpoints through a direct vertical channel', function() {
    const source = participant('Source');
    const target = participant('Target');
    const sourceBounds = { x: 0, y: 0, width: 300, height: 60 };
    const targetBounds = { x: 0, y: 140, width: 300, height: 60 };
    const participantShapes = new Map([
      [ source, sourceBounds ],
      [ target, targetBounds ]
    ]);

    assert.deepStrictEqual(routeMessageFlow(
      source,
      target,
      sourceBounds,
      targetBounds,
      moddle.create('bpmn:Collaboration', {
        participants: [ source, target ],
        messageFlows: []
      }),
      participantShapes,
      [],
      [],
      0
    ), [
      { x: 150, y: 60 },
      { x: 150, y: 140 }
    ]);
  });
});

function participant(id: string) {
  return moddle.create('bpmn:Participant', { id });
}
