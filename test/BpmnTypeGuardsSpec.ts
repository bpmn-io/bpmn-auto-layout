import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';

import {
  isBpmnElement,
  isBpmnType
} from '../lib/layout/bpmn/Types.js';

describe('BPMN type guards', function() {

  it('should narrow moddle elements by BPMN type', async function() {
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(`
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
        <bpmn:process id="Process_1">
          <bpmn:startEvent id="StartEvent_1" />
          <bpmn:endEvent id="EndEvent_1" />
          <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="EndEvent_1" />
        </bpmn:process>
      </bpmn:definitions>
    `);
    const process = definitions.rootElements[0];
    const flow = process.flowElements[2];

    assert.ok(isBpmnElement(flow));
    assert.ok(isBpmnType(flow, 'bpmn:SequenceFlow'));
    assert.strictEqual(flow.sourceRef.id, 'StartEvent_1');
    assert.strictEqual(isBpmnType(flow, 'bpmn:MessageFlow'), false);
    assert.strictEqual(isBpmnElement({}), false);
  });
});
