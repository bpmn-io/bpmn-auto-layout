import assert from 'node:assert';

import { run } from './metrics.mjs';
import { computeMetrics } from './metrics/computeMetrics.js';

describe('Layout metrics', function() {

  this.timeout(10000);

  it('should not contain Band-A geometry defects', async function() {
    await run();
  });

  it('should count endpoint segments that enter their docked shapes', async function() {
    const correct = await computeMetrics(metricFixture([
      [ 200, 140 ],
      [ 300, 140 ]
    ]));
    const wrong = await computeMetrics(metricFixture([
      [ 150, 100 ],
      [ 150, 120 ],
      [ 350, 120 ],
      [ 350, 100 ]
    ]));
    const tangent = await computeMetrics(metricFixture([
      [ 150, 100 ],
      [ 250, 100 ],
      [ 250, 140 ],
      [ 300, 140 ]
    ]));
    const diagonal = await computeMetrics(metricFixture([
      [ 150, 100 ],
      [ 250, 50 ],
      [ 350, 100 ]
    ]));

    assert.strictEqual(correct.wrongWayDockings, 0);
    assert.strictEqual(wrong.wrongWayDockings, 2);
    assert.strictEqual(tangent.wrongWayDockings, 1);
    assert.strictEqual(diagonal.wrongWayDockings, 0);
  });

  it('should exclude artifacts from hard geometry defects', async function() {
    const metrics = await computeMetrics(metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ],
      '<bpmn:textAnnotation id="Annotation" /><bpmn:dataObjectReference id="DataObject" /><bpmn:dataStoreReference id="DataStore" />',
      '<bpmndi:BPMNShape id="Annotation_di" bpmnElement="Annotation"><dc:Bounds x="180" y="120" width="80" height="80" /></bpmndi:BPMNShape><bpmndi:BPMNShape id="DataObject_di" bpmnElement="DataObject"><dc:Bounds x="180" y="120" width="80" height="80" /></bpmndi:BPMNShape><bpmndi:BPMNShape id="DataStore_di" bpmnElement="DataStore"><dc:Bounds x="180" y="120" width="80" height="80" /></bpmndi:BPMNShape>'
    ));

    assert.strictEqual(metrics.overlaps, 0);
    assert.strictEqual(metrics.edgeShapeIntersections, 0);
  });

});

function metricFixture(waypoints, extraSemantic = '', extraDi = '') {
  const waypointXml = waypoints
    .map(([ x, y ]) => `<di:waypoint x="${x}" y="${y}" />`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process">
    <bpmn:task id="Source"><bpmn:outgoing>Flow</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Target"><bpmn:incoming>Flow</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow" sourceRef="Source" targetRef="Target" />
    ${extraSemantic}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Process">
      <bpmndi:BPMNShape id="Source_di" bpmnElement="Source"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Target_di" bpmnElement="Target"><dc:Bounds x="300" y="100" width="100" height="80" /></bpmndi:BPMNShape>
      ${extraDi}
      <bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow">${waypointXml}</bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}