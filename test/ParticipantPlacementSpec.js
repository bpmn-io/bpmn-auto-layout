import assert from 'node:assert';

import {
  sizeAndPositionParticipantsFromMessageAnchors
} from '../lib/layout/collaboration/placement/ParticipantPlacement.js';

describe('ParticipantPlacement', function() {

  it('should position collapsed participants from message anchors', function() {
    const collapsed = element('Collapsed', 'bpmn:Participant');
    const process = element('Process', 'bpmn:Process');
    const expanded = {
      ...element('Expanded', 'bpmn:Participant'),
      processRef: process
    };
    const task = {
      ...element('Task', 'bpmn:Task'),
      $parent: process
    };
    const messageFlow = {
      sourceRef: collapsed,
      targetRef: task
    };
    const participantShapes = new Map([
      [ collapsed, { x: 0, y: 0, width: 100, height: 60 } ],
      [ expanded, { x: 400, y: 140, width: 300, height: 200 } ]
    ]);
    const endpointShapes = new Map([
      ...participantShapes,
      [ task, { x: 450, y: 200, width: 100, height: 80 } ]
    ]);

    sizeAndPositionParticipantsFromMessageAnchors(
      {
        participants: [ collapsed, expanded ],
        messageFlows: [ messageFlow ]
      },
      participantShapes,
      endpointShapes,
      new Map(),
      new Set([ collapsed ]),
      new Set([ collapsed ])
    );

    assert.deepStrictEqual(participantShapes.get(collapsed), {
      x: 450,
      y: 0,
      width: 100,
      height: 60
    });
  });
});

function element(id, type) {
  return {
    id,
    $instanceOf(candidate) {
      return candidate === type;
    }
  };
}
