import assert from 'node:assert';

import { run } from './metrics.mjs';
import { analyzeMetrics, computeMetrics } from './metrics/computeMetrics.js';

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

  it('should count non-orthogonal sequence and message flows but exclude associations', async function() {
    const orthogonal = await computeMetrics(metricFixture([
      [ 200, 140 ],
      [ 250, 140 ],
      [ 250, 100 ],
      [ 300, 100 ]
    ]));
    const diagonal = await computeMetrics(metricFixture([
      [ 200, 140 ],
      [ 250, 90 ],
      [ 300, 100 ]
    ]));
    const association = await computeMetrics(metricFixture([
      [ 200, 140 ],
      [ 250, 90 ],
      [ 300, 100 ]
    ]).replaceAll('bpmn:sequenceFlow', 'bpmn:association'));
    const messageFlow = await computeMetrics(messageFlowMetricFixture([
      [ 200, 140 ],
      [ 250, 90 ],
      [ 300, 100 ]
    ]));

    assert.strictEqual(orthogonal.nonOrthogonalConnections, 0);
    assert.strictEqual(diagonal.nonOrthogonalConnections, 1);
    assert.strictEqual(association.nonOrthogonalConnections, 0);
    assert.strictEqual(messageFlow.nonOrthogonalConnections, 1);
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

  it('should report explicit and renderer-derived label overlaps', async function() {
    const extraSemantic = '<bpmn:task id="Block" />';
    const extraDi = '<bpmndi:BPMNShape id="Block_di" bpmnElement="Block"><dc:Bounds x="220" y="100" width="80" height="80" /></bpmndi:BPMNShape>';
    const implicit = metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ],
      extraSemantic,
      extraDi,
      'name="rejected"'
    );
    const explicit = metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ],
      extraSemantic,
      extraDi
    ).replace(
      '</bpmndi:BPMNEdge>',
      '<bpmndi:BPMNLabel><dc:Bounds x="220" y="110" width="40" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>'
    );
    const container = metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ],
      '<bpmn:subProcess id="Block" />',
      '<bpmndi:BPMNShape id="Block_di" bpmnElement="Block" isExpanded="true"><dc:Bounds x="220" y="100" width="80" height="80" /></bpmndi:BPMNShape>'
    ).replace(
      '</bpmndi:BPMNEdge>',
      '<bpmndi:BPMNLabel><dc:Bounds x="220" y="110" width="40" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>'
    );

    assert.strictEqual((await computeMetrics(implicit)).labelShapeOverlaps, 1);
    assert.strictEqual((await computeMetrics(explicit)).labelShapeOverlaps, 1);
    assert.strictEqual((await computeMetrics(container)).labelShapeOverlaps, 0);
  });

  it('should report labels overlapping connection interiors', async function() {
    const ownEdge = metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ]
    ).replace(
      '</bpmndi:BPMNEdge>',
      '<bpmndi:BPMNLabel><dc:Bounds x="220" y="130" width="40" height="20" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>'
    );
    const shapeLabel = metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ]
    ).replace(
      '</bpmndi:BPMNShape>',
      '<bpmndi:BPMNLabel><dc:Bounds x="220" y="130" width="40" height="20" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>'
    );

    assert.strictEqual((await computeMetrics(ownEdge)).labelEdgeOverlaps, 1);
    assert.strictEqual((await computeMetrics(shapeLabel)).labelEdgeOverlaps, 1);
  });

  it('should expose geometry findings for inspector highlights', async function() {
    const overlap = await analyzeMetrics(metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ],
      '<bpmn:task id="Block" />',
      '<bpmndi:BPMNShape id="Block_di" bpmnElement="Block"><dc:Bounds x="180" y="120" width="80" height="80" /></bpmndi:BPMNShape>'
    ));
    const labelEdge = await analyzeMetrics(metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ]
    ).replace(
      '</bpmndi:BPMNEdge>',
      '<bpmndi:BPMNLabel><dc:Bounds x="220" y="130" width="40" height="20" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>'
    ));
    const labelShape = await analyzeMetrics(metricFixture(
      [
        [ 200, 140 ],
        [ 300, 140 ]
      ],
      '<bpmn:task id="Block" />',
      '<bpmndi:BPMNShape id="Block_di" bpmnElement="Block"><dc:Bounds x="220" y="100" width="80" height="80" /></bpmndi:BPMNShape>'
    ).replace(
      '</bpmndi:BPMNEdge>',
      '<bpmndi:BPMNLabel><dc:Bounds x="220" y="110" width="40" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>'
    ));
    const docking = await analyzeMetrics(metricFixture([
      [ 150, 100 ],
      [ 150, 120 ],
      [ 350, 120 ],
      [ 350, 100 ]
    ]));
    const crossing = await analyzeMetrics(crossingFixture());

    assert.deepStrictEqual(overlap.findings.overlaps, [ {
      shapeIds: [ 'Source', 'Block' ],
      bounds: { x: 180, y: 120, width: 20, height: 60 }
    } ]);
    assert.deepStrictEqual(overlap.findings.edgeShapeIntersections, [ {
      edgeId: 'Flow',
      shapeId: 'Block',
      bounds: { x: 182, y: 122, width: 76, height: 76 }
    } ]);
    assert.deepStrictEqual(labelEdge.findings.labelEdgeOverlaps, [ {
      label: { x: 220, y: 130, width: 40, height: 20, ownerId: 'Flow' },
      edgeId: 'Flow'
    } ]);
    assert.deepStrictEqual(labelShape.findings.labelShapeOverlaps, [ {
      label: { x: 220, y: 110, width: 40, height: 14, ownerId: 'Flow' },
      shapeId: 'Block'
    } ]);
    assert.deepStrictEqual(docking.findings.wrongWayDockings, [ {
      edgeId: 'Flow',
      endpoint: { x: 150, y: 100 },
      shapeId: 'Source'
    }, {
      edgeId: 'Flow',
      endpoint: { x: 350, y: 100 },
      shapeId: 'Target'
    } ]);
    assert.deepStrictEqual(crossing.findings.crossings, [ {
      edgeIds: [ 'FlowOne', 'FlowTwo' ],
      point: { x: 200, y: 200 }
    } ]);
  });

  it('should measure human-oriented layout qualities', async function() {
    const metrics = await computeMetrics(layoutQualityFixture());

    assert.strictEqual(metrics.bendCount, 2);
    assert.strictEqual(metrics.averageEdgeLength, 162.5);
    assert.strictEqual(metrics.edgeSegmentLengthDeviation, 34.4);
    assert.strictEqual(metrics.compactness, 27.4);
    assert.strictEqual(metrics.gridAlignment, 100);
    assert.strictEqual(metrics.branchSymmetry, 100);
  });

  it('should detect asymmetric non-default gateway fans', async function() {
    const metrics = await computeMetrics(layoutQualityFixture(80));

    assert.strictEqual(metrics.branchSymmetry, 33.3);
  });

});

function metricFixture(waypoints, extraSemantic = '', extraDi = '', flowAttributes = '') {
  const waypointXml = waypoints
    .map(([ x, y ]) => `<di:waypoint x="${x}" y="${y}" />`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process">
    <bpmn:task id="Source"><bpmn:outgoing>Flow</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Target"><bpmn:incoming>Flow</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow" sourceRef="Source" targetRef="Target" ${flowAttributes} />
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

function messageFlowMetricFixture(waypoints) {
  const waypointXml = waypoints
    .map(([ x, y ]) => `<di:waypoint x="${x}" y="${y}" />`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collaboration">
    <bpmn:participant id="Source" />
    <bpmn:participant id="Target" />
    <bpmn:messageFlow id="Flow" sourceRef="Source" targetRef="Target" />
  </bpmn:collaboration>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collaboration">
      <bpmndi:BPMNShape id="Source_di" bpmnElement="Source"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Target_di" bpmnElement="Target"><dc:Bounds x="300" y="100" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow">${waypointXml}</bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function layoutQualityFixture(topCenterY = 100) {
  const topY = topCenterY - 40;

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process">
    <bpmn:task id="Source" />
    <bpmn:exclusiveGateway id="Gateway" />
    <bpmn:task id="Top" />
    <bpmn:task id="Middle" />
    <bpmn:task id="Bottom" />
    <bpmn:sequenceFlow id="FlowIn" sourceRef="Source" targetRef="Gateway" />
    <bpmn:sequenceFlow id="FlowTop" sourceRef="Gateway" targetRef="Top" />
    <bpmn:sequenceFlow id="FlowMiddle" sourceRef="Gateway" targetRef="Middle" />
    <bpmn:sequenceFlow id="FlowBottom" sourceRef="Gateway" targetRef="Bottom" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Process">
      <bpmndi:BPMNShape id="Source_di" bpmnElement="Source"><dc:Bounds x="0" y="160" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_di" bpmnElement="Gateway"><dc:Bounds x="175" y="175" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Top_di" bpmnElement="Top"><dc:Bounds x="350" y="${topY}" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Middle_di" bpmnElement="Middle"><dc:Bounds x="350" y="160" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Bottom_di" bpmnElement="Bottom"><dc:Bounds x="350" y="260" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="FlowIn_di" bpmnElement="FlowIn"><di:waypoint x="100" y="200" /><di:waypoint x="175" y="200" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="FlowTop_di" bpmnElement="FlowTop"><di:waypoint x="200" y="175" /><di:waypoint x="200" y="${topCenterY}" /><di:waypoint x="350" y="${topCenterY}" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="FlowMiddle_di" bpmnElement="FlowMiddle"><di:waypoint x="225" y="200" /><di:waypoint x="350" y="200" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="FlowBottom_di" bpmnElement="FlowBottom"><di:waypoint x="200" y="225" /><di:waypoint x="200" y="300" /><di:waypoint x="350" y="300" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function crossingFixture() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process">
    <bpmn:task id="TopLeft"><bpmn:outgoing>FlowOne</bpmn:outgoing></bpmn:task>
    <bpmn:task id="BottomRight"><bpmn:incoming>FlowOne</bpmn:incoming></bpmn:task>
    <bpmn:task id="BottomLeft"><bpmn:outgoing>FlowTwo</bpmn:outgoing></bpmn:task>
    <bpmn:task id="TopRight"><bpmn:incoming>FlowTwo</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="FlowOne" sourceRef="TopLeft" targetRef="BottomRight" />
    <bpmn:sequenceFlow id="FlowTwo" sourceRef="BottomLeft" targetRef="TopRight" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Process">
      <bpmndi:BPMNShape id="TopLeft_di" bpmnElement="TopLeft"><dc:Bounds x="100" y="100" width="40" height="40" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BottomRight_di" bpmnElement="BottomRight"><dc:Bounds x="260" y="260" width="40" height="40" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BottomLeft_di" bpmnElement="BottomLeft"><dc:Bounds x="100" y="260" width="40" height="40" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="TopRight_di" bpmnElement="TopRight"><dc:Bounds x="260" y="100" width="40" height="40" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="FlowOne_di" bpmnElement="FlowOne"><di:waypoint x="140" y="140" /><di:waypoint x="260" y="260" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="FlowTwo_di" bpmnElement="FlowTwo"><di:waypoint x="140" y="260" /><di:waypoint x="260" y="140" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}