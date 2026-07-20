import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';

import { layoutProcess } from 'bpmn-auto-layout';

import { evaluateMetrics } from './metrics/evaluateMetrics.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDirectory = path.join(__dirname, 'fixtures');
const failuresDirectory = path.join(fixturesDirectory, 'failures');
const outputDirectory = path.join(__dirname, 'output');
const snapshotsDirectory = path.join(__dirname, 'snapshots');
const metricsBaselineFile = path.join(__dirname, 'metrics', 'baseline.json');

const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === 'true';


describe('Layout', function() {

  before(function() {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });

    if (UPDATE_SNAPSHOTS) {
      fs.rmSync(snapshotsDirectory, { recursive: true, force: true });
      fs.mkdirSync(snapshotsDirectory, { recursive: true });
    }
  });

  describe('Layout failures', function() {

    const expectedCodes = {
      'collaboration-black-box-only.bpmn': 'UNSUPPORTED_COLLABORATION',
      'camunda-8-tutorials-rpa-orchestration-uipath.bpmn': 'CROSS_SCOPE_SEQUENCE_FLOW',
      'cross-scope-sequence-flow.bpmn': 'CROSS_SCOPE_SEQUENCE_FLOW',
      'duplicate-link-catch.bpmn': 'INVALID_LINK_EVENT_PAIR',
      'invalid-boundary-host.bpmn': 'INVALID_BOUNDARY_HOST',
      'invalid-lane-membership.bpmn': 'INVALID_LANE_MEMBERSHIP',
      'invalid-message-flow-endpoint.bpmn': 'INVALID_MESSAGE_FLOW_ENDPOINT',
      'invalid-participant-process-reference.bpmn': 'INVALID_PARTICIPANT_PROCESS_REFERENCE',
      'invalid-sequence-flow-endpoint.bpmn': 'INVALID_SEQUENCE_FLOW_ENDPOINT',
      'routing-impossible.bpmn': 'ROUTING_FAILED',
      'unknown-visual-type.bpmn': 'UNSUPPORTED_ELEMENT',
      'unmatched-link-event.bpmn': 'INVALID_LINK_EVENT_PAIR',
      'unsupported-visual-element.bpmn': 'UNSUPPORTED_ELEMENT'
    };

    Object.entries(expectedCodes).forEach(([ fileName, code ]) => {
      it(`should reject ${ fileName } with ${ code }`, async function() {
        const xml = fs.readFileSync(path.join(failuresDirectory, fileName), 'utf8');

        await assert.rejects(layoutProcess(xml), error => error.code === code);
      });

    });
  });

  describe('Layout behavior', function() {

    it('should route self-loops into the left side', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'scenario.self-loop.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const cases = [
        [ 'Flow_18uyowd', 'Activity_1qgvwe1' ],
        [ 'Flow_0xvgcqj', 'Gateway_1jhh68n' ],
        [ 'Flow_1rpu3xy', 'Event_1w3l8gz' ]
      ];

      for (const [ flowId, shapeId ] of cases) {
        const shape = shapes.get(shapeId);
        const waypoints = edges.get(flowId);
        const start = waypoints[0];
        const end = waypoints.at(-1);

        assert.strictEqual(start.x, shape.x + shape.width / 2);
        assert.strictEqual(start.y, shape.y + shape.height);
        assert.strictEqual(end.x, shape.x);
        assert.strictEqual(end.y, shape.y + shape.height / 2);
      }
    });

    it('should route boundary-to-host loops into the left side', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'sub-process.expanded-self-loop.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_0y61mnc';
      });
      const source = shapes.get('Event_10irqhg');
      const target = shapes.get('Activity_1u53pwc');
      const start = edge.waypoint[0];
      const end = edge.waypoint.at(-1);

      assert.strictEqual(start.x, source.x + source.width / 2);
      assert.strictEqual(start.y, source.y + source.height);
      assert.strictEqual(end.x, target.x);
      assert.strictEqual(end.y, target.y + target.height / 2);
    });

    it('should preserve nested split and merge bands', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'scenario.issue-131.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const centerY = id => {
        const shape = shapes.get(id);

        return shape.y + shape.height / 2;
      };
      const insuranceBand = [
        'task_6',
        'inclusiveGateway_1',
        'task_1',
        'inclusiveGateway_2'
      ].map(centerY);
      const packageBand = [
        'task_7',
        'inclusiveGateway_3'
      ].map(centerY);

      assert.ok(insuranceBand.every(y => y === insuranceBand[0]));
      assert.ok(packageBand.every(y => y === packageBand[0]));
      assert.ok(centerY('task_3') > insuranceBand[0]);
      assert.ok(centerY('task_9') > packageBand[0]);

      const mergeFlow = edges.get('sequenceFlow_8');
      const source = shapes.get('inclusiveGateway_2');
      const target = shapes.get('exclusiveGateway_2');
      const start = mergeFlow[0];
      const end = mergeFlow.at(-1);

      assert.ok(source.x < target.x);
      assert.strictEqual(start.x, source.x + source.width);
      assert.strictEqual(start.y, source.y + source.height / 2);
      assert.strictEqual(end.x, target.x + target.width / 2);
      assert.strictEqual(end.y, target.y + target.height);
    });

    it('should place alternatives to a default flow on consecutive bands', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.intelligent-routing-with-openai.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const centerY = id => {
        const shape = shapes.get(id);

        return shape.y + shape.height / 2;
      };
      const centerX = shape => shape.x + shape.width / 2;
      const spineY = centerY('Activity_1ltiek0');
      const alternatives = [
        centerY('activity_sales_team'),
        centerY('activity_engineering_team'),
        centerY('Activity_04j3j7a')
      ];

      assert.strictEqual(centerY('gateway_routing'), spineY);
      assert.deepStrictEqual(
        alternatives.map(y => y - spineY),
        [ 160, 320, 480 ]
      );

      const splitChannelX = centerX(shapes.get('gateway_routing'));
      const mergeChannelX = centerX(shapes.get('gateway_sales_team'));

      for (const flowId of [ 'flow_sales_inquiry', 'flow_technical_inquiry', 'Flow_1gj1kgq' ]) {
        assert.strictEqual(edges.get(flowId)[1].x, splitChannelX);
      }

      for (const flowId of [ 'Flow_07h5nkp', 'Flow_088ove7', 'Flow_07c5po9' ]) {
        assert.strictEqual(edges.get(flowId).at(-2).x, mergeChannelX);
      }
    });

    it('should route an implicit task split like a gateway split', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'task.default-flow.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const source = shapes.get('Activity_0ip7259');
      const primary = shapes.get('Activity_0rhh0zi');
      const alternative = shapes.get('Activity_1dc6hvm');
      const branch = edges.get('Flow_1g8zv0u');
      const start = branch[0];
      const end = branch.at(-1);

      assert.strictEqual(source.y, primary.y);
      assert.ok(alternative.y > source.y);
      assert.strictEqual(start.x, source.x + source.width);
      assert.strictEqual(start.y, source.y + source.height / 2);
      assert.strictEqual(end.x, alternative.x);
      assert.strictEqual(end.y, alternative.y + alternative.height / 2);
    });

    it('should route a boundary event split vertically', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'boundary-event.multiple.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const source = shapes.get('Event_1nxutwo');

      for (const flowId of [ 'Flow_0xhtwne', 'Flow_00y4kzn' ]) {
        const branch = edges.get(flowId);
        const start = branch[0];
        const next = branch[1];

        assert.strictEqual(start.x, source.x + source.width / 2);
        assert.strictEqual(start.y, source.y + source.height);
        assert.strictEqual(next.x, start.x);
        assert.ok(next.y > start.y);
      }
    });

    it('should reuse branch bands with disjoint rank intervals', async function() {
      const cases = [
        [ 'gateway.multiple-with-tasks.bpmn', 'Activity_0011ct6', 'Activity_16ahi4e' ],
        [ 'gateway.multiple.bpmn', 'Activity_0qdwjpf', 'Activity_1387cfu' ]
      ];

      for (const [ fixture, firstId, secondId ] of cases) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const shapes = new Map(rootElement.diagrams[0].plane.planeElement
          .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
          .map(element => [ element.bpmnElement.id, element.bounds ]));
        const first = shapes.get(firstId);
        const second = shapes.get(secondId);

        assert.strictEqual(
          first.y + first.height / 2,
          second.y + second.height / 2
        );
      }
    });

    it('should keep boundary handler paths on coherent bands', async function() {
      const cases = [
        [
          'boundary-event.multiple-errors.bpmn',
          [
            [ 'Activity_0nx250w', 'Event_1rboefc' ],
            [ 'Activity_0gr3zyk', 'Event_0wsejh6' ]
          ]
        ],
        [
          'boundary-event.multiple-escalations.bpmn',
          [
            [ 'Activity_1mdcqlq', 'Event_0eftl2j' ],
            [ 'Activity_07jdl6w', 'Event_1xqq3bc' ]
          ]
        ]
      ];

      for (const [ fixture, paths ] of cases) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const shapes = new Map(rootElement.diagrams[0].plane.planeElement
          .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
          .map(element => [ element.bpmnElement.id, element.bounds ]));

        for (const [ activityId, eventId ] of paths) {
          const activity = shapes.get(activityId);
          const event = shapes.get(eventId);

          assert.strictEqual(
            activity.y + activity.height / 2,
            event.y + event.height / 2
          );
        }
      }
    });

    it('should preserve outward boundary-to-task side-center dockings', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'process.error-handling.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_0c4pgkw';
      });
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const source = shapes.get('Event_1clxdkb');
      const target = shapes.get('Activity_14wc4l0');

      const start = edge.waypoint[0];
      const afterStart = edge.waypoint[1];
      const beforeEnd = edge.waypoint.at(-2);
      const end = edge.waypoint.at(-1);

      assert.deepStrictEqual(
        [ start.x, start.y ],
        [ source.x + source.width / 2, source.y + source.height ]
      );
      assert.strictEqual(afterStart.x, start.x);
      assert.ok(afterStart.y > start.y);
      assert.deepStrictEqual(
        [ end.x, end.y ],
        [ target.x, target.y + target.height / 2 ]
      );
      assert.strictEqual(beforeEnd.y, end.y);
      assert.ok(beforeEnd.x < end.x);
    });

    it('should order same-side boundary handlers by outward destination distance', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'process.error-handling.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const boundaries = [
        shapes.get('Event_1clxdkb'),
        shapes.get('Event_0ewdllh'),
        shapes.get('Event_0r8l2hk')
      ];

      assert.ok(boundaries[0].x < boundaries[1].x);
      assert.ok(boundaries[1].x < boundaries[2].x);

      for (const flowId of [ 'Flow_0c4pgkw', 'Flow_188kodm', 'Flow_0dypxqu' ]) {
        const waypoints = edges.get(flowId);

        assert.strictEqual(waypoints.length, 3);
        assert.strictEqual(waypoints[0].x, waypoints[1].x);
        assert.ok(waypoints[1].y > waypoints[0].y);
        assert.strictEqual(waypoints[1].y, waypoints[2].y);
        assert.ok(waypoints[2].x > waypoints[1].x);
      }
    });

    it('should route boundary handlers through a vertical exit stub', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.safeguard-agent.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_0rs9uw9';
      });
      const source = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.id === 'Event_00rqlj4';
      }).bounds;

      assert.deepStrictEqual(
        [ edge.waypoint[0].x, edge.waypoint[0].y ],
        [ source.x + source.width / 2, source.y + source.height ]
      );
      assert.strictEqual(edge.waypoint[1].x, edge.waypoint[0].x);
      assert.ok(edge.waypoint[1].y > edge.waypoint[0].y);
    });

    it('should preserve side-center dockings on orthogonal link-catch routes', async function() {
      const xml = fs.readFileSync(
        path.join(
          fixturesDirectory,
          'blueprint.capital-market-trade-exception-remediation-processing.bpmn'
        ),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_1b8h5fq';
      });
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const source = shapes.get('Event_004398z');
      const target = shapes.get('Gateway_0z4dryr');

      assert.deepStrictEqual(
        edge.waypoint.map(({ x, y }) => [ x, y ]),
        [
          [ source.x + source.width / 2, source.y ],
          [ source.x + source.width / 2, target.y + target.height + 20 ],
          [ target.x + target.width / 2, target.y + target.height + 20 ],
          [ target.x + target.width / 2, target.y + target.height ]
        ]
      );
    });

    it('should preserve side-center dockings when an edge crossing is unavoidable', async function() {
      const xml = fs.readFileSync(
        path.join(
          fixturesDirectory,
          'camunda-8-tutorials.insurance-personal-property-damage-claim-handling.bpmn'
        ),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_0yaksw4';
      });
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const source = shapes.get('Event_0jpjmuu');
      const target = shapes.get('Gateway_01i08li');

      assert.deepStrictEqual(
        [ edge.waypoint[0].x, edge.waypoint[0].y ],
        [ source.x + source.width, source.y + source.height / 2 ]
      );
      assert.deepStrictEqual(
        [ edge.waypoint.at(-1).x, edge.waypoint.at(-1).y ],
        [ target.x, target.y + target.height / 2 ]
      );
      assert.strictEqual(edge.waypoint[1].y, edge.waypoint[0].y);
      assert.strictEqual(edge.waypoint.at(-2).y, edge.waypoint.at(-1).y);
    });

    it('should align paired link events', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'link-event.basic.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const throwEvent = shapes.get('Event_1rucaji');
      const catchEvent = shapes.get('Event_1a542f8');

      assert.strictEqual(
        throwEvent.y + throwEvent.height / 2,
        catchEvent.y + catchEvent.height / 2
      );
    });

    it('should keep boundary handler endings in their exception bands', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'boundary-event.mixed.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapeById = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element ]));
      const edgeById = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element ]));

      const escalationEnd = shapeById.get('Event_1p8cxs1').bounds;
      const spineEnd = shapeById.get('Event_0a0zgeb').bounds;
      const errorEnd = shapeById.get('Event_1ddzbfs').bounds;

      assert.ok(escalationEnd.y < spineEnd.y);
      assert.ok(errorEnd.y > spineEnd.y);
      assert.strictEqual(spineEnd.y - escalationEnd.y, 160);
      assert.strictEqual(errorEnd.y - spineEnd.y, 160);
      assert.strictEqual(edgeById.get('Flow_0hkw5ew').waypoint.length, 2);
      assert.strictEqual(edgeById.get('Flow_0thxoj6').waypoint.length, 2);

      const escalationHandler = shapeById.get('Activity_1rfy4sx').bounds;
      const errorHandler = shapeById.get('Activity_1axkrtx').bounds;
      const escalationFlow = edgeById.get('Flow_0g36zvl').waypoint.at(-1);
      const errorFlow = edgeById.get('Flow_008axep').waypoint.at(-1);

      for (const id of [ 'Flow_1ea03uj', 'Flow_1xpqfyn', 'Flow_03c633m', 'Flow_1pe80xw' ]) {
        const waypoints = edgeById.get(id).waypoint;
        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].y, waypoints[1].y);
      }

      assert.strictEqual(edgeById.get('Flow_0g36zvl').waypoint.length, 3);
      assert.strictEqual(edgeById.get('Flow_008axep').waypoint.length, 3);
      assert.strictEqual(escalationFlow.x, escalationHandler.x);
      assert.strictEqual(escalationFlow.y, escalationHandler.y + escalationHandler.height / 2);
      assert.strictEqual(errorFlow.x, errorHandler.x);
      assert.strictEqual(errorFlow.y, errorHandler.y + errorHandler.height / 2);
    });

    it('should place lower boundary paths below the normal-flow spine', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'boundary-event.simple.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));

      assert.ok(shapes.get('Event_01xq0ps').y > shapes.get('Event_1w296ux').y);

      const spineFlow = edges.get('Flow_1guv5l8');
      assert.strictEqual(spineFlow.length, 2);
      assert.strictEqual(spineFlow[0].y, spineFlow[1].y);
    });

    it('should keep the spine straight when boundary handlers rejoin it directly', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'boundary-event.handler-rejoin.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element ]));
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));

      const spine = [
        'Flow_0o3o2nn',
        'Flow_0w8ctq7',
        'Flow_0cpylw4',
        'Flow_12e55zr',
        'Flow_136dbou',
        'Flow_1x71ksb'
      ].map(id => edges.get(id).waypoint);

      for (const waypoints of spine) {
        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].y, waypoints[1].y);
      }

      const errorRejoin = edges.get('Flow_06l6g9v').waypoint;
      const errorTarget = shapes.get('Activity_10e766t');
      assert.strictEqual(errorRejoin.at(-1).x, errorTarget.x + errorTarget.width / 2);
      assert.strictEqual(errorRejoin.at(-1).y, errorTarget.y + errorTarget.height);
      assert.strictEqual(errorRejoin.at(-2).x, errorRejoin.at(-1).x);

      const escalationRejoin = edges.get('Flow_1lokt4o').waypoint;
      const escalationTarget = shapes.get('Activity_17ref4v');
      assert.strictEqual(escalationRejoin.at(-1).x, escalationTarget.x + escalationTarget.width / 2);
      assert.strictEqual(escalationRejoin.at(-1).y, escalationTarget.y);
      assert.strictEqual(escalationRejoin.at(-2).x, escalationRejoin.at(-1).x);
    });

    it('should keep the primary gateway path straight', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'gateway.multiple.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const edges = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element ]));

      const spine = [
        'Flow_174mdxz',
        'Flow_0x21408',
        'Flow_1825yj3',
        'Flow_0lt2wxp',
        'Flow_1ge6e6x'
      ].map(id => edges.get(id).waypoint);

      for (const waypoints of spine) {
        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].y, waypoints[1].y);
      }

      const directBranch = edges.get('Flow_0cwbrfm').waypoint;
      assert.strictEqual(directBranch.length, 3);
      assert.strictEqual(directBranch[0].x, directBranch[1].x);
      assert.strictEqual(directBranch[1].y, directBranch[2].y);

      const routedBranch = edges.get('Flow_0p0ho5k').waypoint;
      assert.strictEqual(routedBranch.length, 3);
      assert.strictEqual(routedBranch[0].x, routedBranch[1].x);
      assert.strictEqual(routedBranch[1].y, routedBranch[2].y);

      const feedback = edges.get('Flow_137be2r').waypoint;
      assert.strictEqual(feedback.length, 4);
      assert.ok(feedback[1].y > routedBranch.at(-1).y);
      assert.strictEqual(feedback[0].x, feedback[1].x);
      assert.strictEqual(feedback[1].y, feedback[2].y);
      assert.strictEqual(feedback[2].x, feedback[3].x);
    });

    it('should dock vertical gateway joins at the gateway center', async function() {
      for (const fixture of [ 'process.joining-flows.bpmn', 'scenario.declaration-order-ties.bpmn' ]) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const elements = rootElement.diagrams[0].plane.planeElement;
        const shapes = new Map(elements
          .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
          .map(element => [ element.bpmnElement.id, element.bounds ]));
        const edges = new Map(elements
          .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
          .map(element => [ element.bpmnElement.id, element.waypoint ]));
        const cases = fixture === 'process.joining-flows.bpmn'
          ? [ [ 'Flow_0dxn10w', 'Gateway_1opkwdv' ] ]
          : [
            [ 'Flow_1n9oafc', 'Gateway_1y0jp8s' ],
            [ 'Flow_0ir1377', 'Gateway_1y0jp8s' ]
          ];

        for (const [ flowId, gatewayId ] of cases) {
          const waypoints = edges.get(flowId);
          const gateway = shapes.get(gatewayId);
          const end = waypoints.at(-1);

          assert.strictEqual(waypoints.length, 3);
          assert.strictEqual(end.x, gateway.x + gateway.width / 2);
          assert.ok(end.y === gateway.y || end.y === gateway.y + gateway.height);
          assert.strictEqual(waypoints.at(-2).x, end.x);
        }
      }
    });

    it('should keep primary paths straight across all components', async function() {
      const cases = [
        [ 'link-event.throw-catch.bpmn', 'Flow_1pi9i8e' ],
        [ 'gateway.loop-back.bpmn', 'Flow_l65bcwkx0' ],
        [ 'scenario.multiple-starts.bpmn', 'Flow_0giy03q' ]
      ];

      for (const [ fixture, flowId ] of cases) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const edge = rootElement.diagrams[0].plane.planeElement.find(element => {
          return element.$instanceOf('bpmndi:BPMNEdge') && element.bpmnElement.id === flowId;
        });

        assert.strictEqual(edge.waypoint.length, 2);
        assert.strictEqual(edge.waypoint[0].y, edge.waypoint[1].y);
      }
    });

    it('should orient forward cross-band target dockings outward', async function() {
      const cases = [
        [ 'link-event.loop.bpmn', 'Flow_1u3074k' ],
        [ 'lane.nested.bpmn', 'Flow_1l04nek' ]
      ];

      for (const [ fixture, flowId ] of cases) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const elements = rootElement.diagrams[0].plane.planeElement;
        const edge = elements.find(element => {
          return element.$instanceOf('bpmndi:BPMNEdge') && element.bpmnElement.id === flowId;
        });
        const target = elements.find(element => {
          return element.$instanceOf('bpmndi:BPMNShape') &&
            element.bpmnElement === edge.bpmnElement.targetRef;
        }).bounds;
        const end = edge.waypoint.at(-1);
        const adjacent = edge.waypoint.at(-2);
        const outward =
          (end.y === target.y && adjacent.y < end.y) ||
          (end.y === target.y + target.height && adjacent.y > end.y) ||
          (end.x === target.x && adjacent.x < end.x) ||
          (end.x === target.x + target.width && adjacent.x > end.x);

        assert.ok(outward);
        assert.ok(edge.waypoint.length <= 4);
      }
    });

    it('should keep terminal gateway branches compact with one bend', async function() {
      const cases = [
        [ 'gateway.exclusive-default.bpmn', 'Flow_0bxi7vh' ],
        [ 'gateway.exclusive-no-default.bpmn', 'Flow_0612ff4' ],
        [ 'gateway.future-incoming.bpmn', 'Flow_0os3n7r' ]
      ];

      for (const [ fixture, flowId ] of cases) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const elements = rootElement.diagrams[0].plane.planeElement;
        const edge = elements.find(element => {
          return element.$instanceOf('bpmndi:BPMNEdge') && element.bpmnElement.id === flowId;
        });
        const source = elements.find(element => {
          return element.$instanceOf('bpmndi:BPMNShape') &&
            element.bpmnElement === edge.bpmnElement.sourceRef;
        }).bounds;
        const target = elements.find(element => {
          return element.$instanceOf('bpmndi:BPMNShape') &&
            element.bpmnElement === edge.bpmnElement.targetRef;
        }).bounds;

        assert.strictEqual(edge.waypoint.length, 3);
        assert.strictEqual(edge.waypoint[0].x, source.x + source.width / 2);
        assert.strictEqual(edge.waypoint.at(-1).x, target.x);
        assert.ok(target.x - source.x < 250);
      }
    });

    it('should align nested gateway joins in their enclosing branch', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'gateway.nested.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_0k5axi6';
      });
      const nestedSplit = shapes.get('Gateway_1jo93d2');
      const nestedJoin = shapes.get('Gateway_1f6wfdt');
      const outerJoin = shapes.get('Gateway_1f1stuw');

      assert.strictEqual(
        nestedJoin.y + nestedJoin.height / 2,
        nestedSplit.y + nestedSplit.height / 2
      );
      assert.strictEqual(nestedJoin.x, outerJoin.x);
      assert.strictEqual(edge.waypoint.length, 2);
      assert.strictEqual(edge.waypoint[0].x, edge.waypoint[1].x);
    });

    it('should preserve straight spines for implicit starts and long branch edges', async function() {
      const cases = [
        [ 'scenario.happy-path.bpmn', [ 'Flow_0yql2id', 'Flow_1jqd6cn', 'Flow_04fevuo', 'Flow_0lzabzl' ] ],
        [ 'scenario.long-branch-edge.bpmn', [ 'Flow_1cus582', 'Flow_0rc84bw', 'Flow_1ivp9an', 'Flow_0evcr55' ] ]
      ];

      for (const [ fixture, flowIds ] of cases) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const edges = new Map(rootElement.diagrams[0].plane.planeElement
          .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
          .map(element => [ element.bpmnElement.id, element.waypoint ]));

        for (const flowId of flowIds) {
          const waypoints = edges.get(flowId);

          assert.strictEqual(waypoints.length, 2);
          assert.strictEqual(waypoints[0].y, waypoints[1].y);
        }
      }
    });

    it('should break process cycles relative to their semantic start', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.fraud-detection-process.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const spine = [
        'StartEvent_1',
        'Gateway_0cttbk8',
        'Activity_0p69xia',
        'Activity_1cq5ima',
        'Activity_1ddcn10',
        'Activity_0zfrajx',
        'Gateway_0y12zon',
        'Event_0vgcvn8'
      ].map(id => shapes.get(id));

      for (let index = 1; index < spine.length; index++) {
        assert.ok(spine[index - 1].x < spine[index].x);
      }

      assert.strictEqual(edges.get('Flow_0xyotmo').length, 2);

      const feedback = edges.get('Flow_1yea5o1');

      assert.strictEqual(feedback.length, 4);
      assert.ok(feedback[0].x > feedback.at(-1).x);
      assert.strictEqual(feedback[0].x, feedback[1].x);
      assert.strictEqual(feedback[1].y, feedback[2].y);
      assert.strictEqual(feedback[2].x, feedback[3].x);
    });

    it('should include boundary handler paths when breaking process cycles', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.car-rental-booking-process.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapeDi = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element ]));
      const shapes = new Map([ ...shapeDi ]
        .map(([ id, element ]) => [ id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const centerY = shape => shape.y + shape.height / 2;
      const restart = shapes.get('Event_0rzd7z1');
      const availability = shapes.get('Activity_0oprw8j');
      const restartFeedback = edges.get('Flow_040xkfg');

      assert.ok(restart.y < availability.y);
      assert.strictEqual(restartFeedback.length, 4);
      assert.ok(restartFeedback[1].y < restart.y);
      assert.strictEqual(restartFeedback[1].y, restartFeedback[2].y);
      assert.strictEqual(restartFeedback[0].y, restart.y);
      assert.strictEqual(
        restartFeedback.at(-1).y,
        shapes.get('Gateway_15i2i2v').y
      );

      const topBoundary = shapeDi.get('Event_157ki77');

      assert.ok(topBoundary.label);
      assert.ok(
        topBoundary.label.bounds.y + topBoundary.label.bounds.height <=
        topBoundary.bounds.y
      );
      assert.ok(
        topBoundary.label.bounds.x + topBoundary.label.bounds.width <=
        edges.get('Flow_02jizw3')[0].x
      );

      const completionPath = [
        'Event_0scoigv',
        'Gateway_11m63z7',
        'Activity_0tw025l',
        'Event_0dehha8'
      ].map(id => shapes.get(id));

      for (let index = 1; index < completionPath.length; index++) {
        assert.ok(completionPath[index - 1].x < completionPath[index].x);
        assert.strictEqual(
          centerY(completionPath[index - 1]),
          centerY(completionPath[index])
        );
      }

      for (const flowId of [ 'Flow_0q05zbm', 'Flow_15xuq47', 'Flow_1ug9iwb' ]) {
        const waypoints = edges.get(flowId);

        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].y, waypoints[1].y);
      }
    });

    it('should prefer a normal completion path over terminal alternatives', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.safeguard-agent.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const spineIds = [
        'StartEvent',
        'Gateway_1p1pn0e',
        'Gateway_0w64q2a',
        'Gateway_05mu4di',
        'Activity_1t4newl',
        'Gateway_0clysfw',
        'Gateway_0d4d9o9',
        'EndEvent_safeGuardResult'
      ];
      const spine = spineIds.map(id => shapes.get(id));
      const centerY = bounds => bounds.y + bounds.height / 2;

      for (let index = 1; index < spine.length; index++) {
        assert.ok(spine[index - 1].x < spine[index].x);
        assert.strictEqual(centerY(spine[index - 1]), centerY(spine[index]));
      }

      for (const flowId of [
        'Flow_0lt0315',
        'Flow_036jkrd',
        'Flow_0xmwxku',
        'Flow_1p2523e',
        'Flow_14bythg',
        'Flow_0x8hjc4',
        'Flow_0yl024c'
      ]) {
        const waypoints = edges.get(flowId);

        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].y, waypoints[1].y);
      }
    });

    it('should route shape-spanning forward edges like feedback edges', async function() {
      const cases = [
        [ 'scenario.happy-path.bpmn', [ 'Flow_1cp2keh' ] ],
        [ 'scenario.long-branch-edge.bpmn', [ 'Flow_0aas87b', 'Flow_0o3atp0' ] ]
      ];

      for (const [ fixture, flowIds ] of cases) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const elements = rootElement.diagrams[0].plane.planeElement;
        const shapes = new Map(elements
          .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
          .map(element => [ element.bpmnElement.id, element.bounds ]));
        const edges = new Map(elements
          .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
          .map(element => [ element.bpmnElement.id, element ]));

        for (const flowId of flowIds) {
          const edge = edges.get(flowId);
          const source = shapes.get(edge.bpmnElement.sourceRef.id);
          const target = shapes.get(edge.bpmnElement.targetRef.id);
          const waypoints = edge.waypoint;

          assert.strictEqual(waypoints.length, 4);
          assert.strictEqual(waypoints[0].x, source.x + source.width / 2);
          assert.strictEqual(waypoints[0].y, source.y + source.height);
          assert.strictEqual(waypoints.at(-1).x, target.x + target.width / 2);
          assert.strictEqual(waypoints.at(-1).y, target.y + target.height);
          assert.strictEqual(waypoints[1].y, waypoints[2].y);
        }
      }
    });

    it('should choose the shortest default-flow channel independent of text annotations', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'camunda-8-tutorials.expense-reimbursement.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const source = shapes.get('Gateway_1wrjn3x');
      const target = shapes.get('Gateway_0v75kn8');
      const waypoints = edges.get('Flow_07hh01v');

      assert.strictEqual(waypoints.length, 4);
      assert.strictEqual(waypoints[0].x, source.x + source.width / 2);
      assert.strictEqual(waypoints[0].y, source.y);
      assert.strictEqual(waypoints.at(-1).x, target.x + target.width / 2);
      assert.strictEqual(waypoints.at(-1).y, target.y);
      assert.ok(waypoints[1].y < source.y);
      assert.strictEqual(waypoints[1].y, waypoints[2].y);
    });

    it('should dock tall cross-band sources by their connection-port centers', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'scenario.multiple-sub-processes.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const target = shapes.get('Gateway_09tcbh1');
      const upperIncoming = edges.get('Flow_0hj0rzi').at(-1);
      const lowerIncoming = edges.get('Flow_0zvhqhx').at(-1);

      assert.strictEqual(upperIncoming.x, target.x + target.width / 2);
      assert.strictEqual(upperIncoming.y, target.y);
      assert.strictEqual(lowerIncoming.x, target.x + target.width / 2);
      assert.strictEqual(lowerIncoming.y, target.y + target.height);
    });

    it('should assign nested U-routes by span depth', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'scenario.determinism.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const edges = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const outerChannelY = edges.get('Flow_15iulmx')[1].y;
      const innerChannelY = edges.get('Flow_0vvqlx7')[1].y;

      assert.strictEqual(outerChannelY - innerChannelY, 20);
    });

    it('should route overlapping U-spans below later-starting spans', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'gateway.multiple-complex.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const edges = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const channels = [
        'Flow_0tifn2t',
        'Flow_1ceaqcv',
        'Flow_0noq65r',
        'Flow_13am6r7'
      ].map(id => edges.get(id)[1].y);

      assert.deepStrictEqual(channels, [ 240, 220, 200, 180 ]);
    });

    it('should route message flows between process nodes through the pool gutter', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'collaboration.message-flows.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_0y9bbj6';
      });
      const source = shapes.get(edge.bpmnElement.sourceRef.id);
      const target = shapes.get(edge.bpmnElement.targetRef.id);

      assert.strictEqual(edge.waypoint.length, 4);
      assert.strictEqual(edge.waypoint[0].x, source.x + source.width / 2);
      assert.strictEqual(edge.waypoint[0].y, source.y + source.height);
      assert.strictEqual(edge.waypoint.at(-1).x, target.x + target.width / 2);
      assert.strictEqual(edge.waypoint.at(-1).y, target.y);
      assert.strictEqual(edge.waypoint[1].y, edge.waypoint[2].y);
    });

    it('should route message flows from collapsed subprocess children at the subprocess', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'collaboration.message-flow-to-collapsed-child.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'MessageFlow';
      });
      const source = shapes.get('CollapsedSubProcess');
      const target = shapes.get('ReceiveTask');

      assert.ok(!shapes.has('HiddenTask'));
      assert.strictEqual(edge.waypoint[0].x, source.x + source.width / 2);
      assert.strictEqual(edge.waypoint[0].y, source.y + source.height);
      assert.strictEqual(edge.waypoint.at(-1).x, target.x + target.width / 2);
      assert.strictEqual(edge.waypoint.at(-1).y, target.y);
    });

    it('should optimize connected participant geometry', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.bank-customer-complaint-dispute-handling.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const bank = shapes.get('Participant_06rogqo');
      const vendor = shapes.get('Participant_036pi5i');
      const systems = shapes.get('Participant_1hny6d4');
      const customer = shapes.get('Participant_15e0f4x');
      const escalationBoundary = shapes.get('Event_0jastu6');
      const manualDecision = shapes.get('Activity_0ynau00');
      const escalationFlow = edges.get('Flow_1g6chbg');

      for (const id of [ 'Participant_15e0f4x', 'Participant_036pi5i', 'Participant_1hny6d4' ]) {
        const participant = shapes.get(id);

        assert.strictEqual(participant.height, 60);
        assert.ok(participant.width <= bank.width);
      }
      assert.ok([ vendor, systems, customer ].some(participant => {
        return participant.width < bank.width;
      }));

      for (const edge of elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.$instanceOf('bpmn:MessageFlow');
      })) {
        const sourceBounds = shapes.get(edge.bpmnElement.sourceRef.id);
        const targetBounds = shapes.get(edge.bpmnElement.targetRef.id);

        if (edge.bpmnElement.sourceRef.$instanceOf('bpmn:Participant')) {
          assert.ok(edge.waypoint[0].x >= sourceBounds.x);
          assert.ok(edge.waypoint[0].x <= sourceBounds.x + sourceBounds.width);
        }
        if (edge.bpmnElement.targetRef.$instanceOf('bpmn:Participant')) {
          assert.ok(edge.waypoint.at(-1).x >= targetBounds.x);
          assert.ok(edge.waypoint.at(-1).x <= targetBounds.x + targetBounds.width);
        }
      }

      assert.ok(vendor.y < bank.y);
      assert.ok(bank.y < systems.y);
      assert.ok(systems.y < customer.y);
      assert.strictEqual(escalationFlow[0].x, escalationBoundary.x + escalationBoundary.width / 2);
      assert.strictEqual(escalationFlow[0].y, escalationBoundary.y);
      assert.strictEqual(escalationFlow[1].x, escalationFlow[0].x);
      assert.ok(escalationFlow[1].y < escalationFlow[0].y);
      assert.strictEqual(
        escalationFlow[1].y,
        manualDecision.y + manualDecision.height / 2
      );

      for (const flowId of [
        'Flow_05gvfe6',
        'Flow_02t6si4',
        'Flow_0p6l11s',
        'Flow_0dzo3px',
        'Flow_13s9ktm',
        'Flow_0z6ld7a',
        'Flow_0tr7v97',
        'Flow_1vk4qol',
        'Flow_167hzvh',
        'Flow_0nx8yam',
        'Flow_0ti5pvk',
        'Flow_106ia8a',
        'Flow_1vatont'
      ]) {
        const waypoints = edges.get(flowId);

        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].x, waypoints[1].x);
      }

      const blockedSource = shapes.get('Activity_0maynr7');
      const verticalBypass = edges.get('Flow_0u8tf4h');

      assert.strictEqual(verticalBypass.length, 4);
      assert.strictEqual(verticalBypass[0].x, blockedSource.x + blockedSource.width / 2);
      assert.strictEqual(verticalBypass[0].y, blockedSource.y + blockedSource.height);
      assert.strictEqual(verticalBypass[1].x, verticalBypass[0].x);
      assert.strictEqual(verticalBypass[1].y, verticalBypass[0].y + 20);
      assert.strictEqual(verticalBypass[2].x, blockedSource.x + blockedSource.width + 20);
      assert.strictEqual(verticalBypass[2].y, verticalBypass[1].y);
      assert.strictEqual(verticalBypass[3].x, verticalBypass[2].x);

      for (const [ nodeId, outgoingId, incomingId ] of [
        [ 'Activity_199882v', 'Flow_0p6l11s', 'Flow_0dzo3px' ],
        [ 'Activity_03cktkd', 'Flow_0tr7v97', 'Flow_1vk4qol' ],
        [ 'Activity_0ynau00', 'Flow_0nx8yam', 'Flow_0ti5pvk' ],
        [ 'Activity_03cktkd', 'Flow_106ia8a', 'Flow_1vatont' ]
      ]) {
        const node = shapes.get(nodeId);
        const centerX = node.x + node.width / 2;
        const outgoingX = edges.get(outgoingId)[0].x;
        const incomingX = edges.get(incomingId).at(-1).x;

        assert.strictEqual(outgoingX, centerX - 10);
        assert.strictEqual(incomingX, centerX + 10);
      }
    });

    it('should size and position collapsed participants from message anchors', async function() {
      const xml = fs.readFileSync(
        path.join(
          fixturesDirectory,
          'camunda-8-tutorials.car-rental-booking-process.bpmn'
        ),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const booking = shapes.get('Participant_0gpkl5f');
      const customer = shapes.get('Participant_0eew51h');
      const fico = shapes.get('Participant_0gxiry8');
      const systems = shapes.get('Participant_1aqz907');

      assert.strictEqual(fico.width, 300);
      assert.ok(fico.x > booking.x);
      assert.ok(systems.x > booking.x);
      assert.ok(systems.x + systems.width < booking.x + booking.width);

      for (const participant of [ customer, fico, systems ]) {
        assert.strictEqual(participant.height, 60);
        assert.ok(participant.width <= booking.width);
      }

      for (const edge of elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.$instanceOf('bpmn:MessageFlow');
      })) {
        const sourceBounds = shapes.get(edge.bpmnElement.sourceRef.id);
        const targetBounds = shapes.get(edge.bpmnElement.targetRef.id);

        if (edge.bpmnElement.sourceRef.$instanceOf('bpmn:Participant')) {
          assert.ok(edge.waypoint[0].x >= sourceBounds.x);
          assert.ok(edge.waypoint[0].x <= sourceBounds.x + sourceBounds.width);
        }
        if (edge.bpmnElement.targetRef.$instanceOf('bpmn:Participant')) {
          assert.ok(edge.waypoint.at(-1).x >= targetBounds.x);
          assert.ok(edge.waypoint.at(-1).x <= targetBounds.x + targetBounds.width);
        }
      }
    });

    it('should include obstacle-avoiding message docks in collapsed participants', async function() {
      const xml = fs.readFileSync(
        path.join(
          fixturesDirectory,
          'camunda-8-tutorials.telco-service-order-fulfillment-retail.bpmn'
        ),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const messageFlows = elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.$instanceOf('bpmn:MessageFlow');
      });

      for (const edge of messageFlows) {
        for (const [ endpoint, waypoint ] of [
          [ edge.bpmnElement.sourceRef, edge.waypoint[0] ],
          [ edge.bpmnElement.targetRef, edge.waypoint.at(-1) ]
        ]) {
          if (!endpoint.$instanceOf('bpmn:Participant')) {
            continue;
          }

          const participant = shapes.get(endpoint.id);

          assert.ok(waypoint.x >= participant.x);
          assert.ok(waypoint.x <= participant.x + participant.width);
        }
      }

      const hardware = shapes.get('Participant_14yof8d');
      const avoidedDock = messageFlows.find(edge => {
        return edge.bpmnElement.id === 'Flow_1kciunv';
      }).waypoint[0];

      assert.ok(avoidedDock.x < hardware.x + hardware.width);
    });

    it('should place text annotations after message-independent process routing', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.event-registration.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_1p4u8s4';
      });
      const annotation = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.id === 'TextAnnotation_event_reg_intro';
      }).bounds;

      assert.strictEqual(edge.waypoint.length, 2);
      assert.strictEqual(edge.waypoint[0].x, edge.waypoint[1].x);
      assert.ok(
        annotation.x + annotation.width <= edge.waypoint[0].x ||
        annotation.x >= edge.waypoint[0].x
      );
    });

    it('should size and place long text annotations without covering process flow', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.intelligent-routing-with-openai.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNShape');
      });
      const annotationShape = shapes.find(element => {
        return element.bpmnElement.id === 'TextAnnotation_openai_routing_intro';
      });
      const annotation = annotationShape.bounds;
      const processShapes = shapes.filter(element => {
        return element !== annotationShape &&
          !element.bpmnElement.$instanceOf('bpmn:Participant') &&
          !element.bpmnElement.$instanceOf('bpmn:Lane');
      });

      assert.ok(annotation.width >= 220);
      assert.ok(annotation.width / annotation.height >= 2);

      for (const shape of processShapes) {
        const other = shape.bounds;
        const overlaps = annotation.x < other.x + other.width &&
          other.x < annotation.x + annotation.width &&
          annotation.y < other.y + other.height &&
          other.y < annotation.y + annotation.height;

        assert.strictEqual(overlaps, false, shape.bpmnElement.id);
      }
    });

    it('should allow text annotations outside their owner participant', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.telco-service-order-fulfillment-retail.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const annotation = shapes.get('TextAnnotation_telco_intro');
      const lane = shapes.get('Lane_1wct3t6');
      const participant = shapes.get('Participant_1s99fxr');

      assert.ok(annotation.x + annotation.width <= participant.x ||
        annotation.x >= participant.x + participant.width ||
        annotation.y + annotation.height <= participant.y ||
        annotation.y >= participant.y + participant.height);
      assert.strictEqual(participant.width - lane.width, 30);
    });

    it('should keep data object references inside their owner lane', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'process.application-processing.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const dataObject = shapes.get('sid-8D8BD39F-1B08-433F-8F93-A1FF7520BA8B');
      const lane = shapes.get('sid-4E447BCA-4A6B-4944-8A1C-1A184D6A95FD');

      assert.ok(dataObject.x >= lane.x);
      assert.ok(dataObject.y >= lane.y);
      assert.ok(dataObject.x + dataObject.width <= lane.x + lane.width);
      assert.ok(dataObject.y + dataObject.height <= lane.y + lane.height);
    });

    it('should keep strongly connected collapsed participants adjacent', async function() {
      const xml = fs.readFileSync(
        path.join(
          fixturesDirectory,
          'blueprint.capital-market-trade-exception-remediation-processing.bpmn'
        ),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const stockExchange = shapes.get('Participant_15apx5k');
      const capitalMarket = shapes.get('Participant_0k9adwh');
      const broker = shapes.get('Participant_0wig6e9');
      const customer = shapes.get('Participant_1fh4ivu');

      assert.ok(stockExchange.y < capitalMarket.y);
      assert.ok(capitalMarket.y < broker.y);
      assert.strictEqual(customer.y - broker.y - broker.height, 80);
    });

    it('should emit artifact DI with boundary-docked associations', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'text-annotation.positioning.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Association_1kb9jbi';
      });
      const owner = shapes.get('Activity_0guwzdt');
      const annotation = shapes.get('TextAnnotation_0efhpjt');

      assert.ok(annotation);
      assert.ok(edge);
      assert.strictEqual(edge.waypoint[0].x, owner.x + owner.width / 2);
      assert.strictEqual(edge.waypoint[0].y, owner.y);
      assert.strictEqual(edge.waypoint.at(-1).x, annotation.x + annotation.width / 2);
      assert.strictEqual(edge.waypoint.at(-1).y, annotation.y + annotation.height);
    });

    it('should emit activity-owned data association DI', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'data-object-and-store.reference.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const associationIds = new Set([
        'DataInputAssociation_0mj2l3x',
        'DataOutputAssociation_1w3k5cq',
        'DataInputAssociation_1jjpwt9'
      ]);
      const edges = elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          associationIds.has(element.bpmnElement.id);
      });

      assert.strictEqual(edges.length, associationIds.size);
      assert.ok(edges.every(edge => edge.waypoint.length >= 2));

      const secondTask = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.id === 'Activity_1g6x9ev';
      });
      const secondInput = edges.find(edge => {
        return edge.bpmnElement.id === 'DataInputAssociation_1jjpwt9';
      });
      const target = secondInput.waypoint.at(-1);
      const bounds = secondTask.bounds;
      const sideCenter =
        (
          (target.x === bounds.x || target.x === bounds.x + bounds.width) &&
          target.y === bounds.y + bounds.height / 2
        ) ||
        (
          (target.y === bounds.y || target.y === bounds.y + bounds.height) &&
          target.x === bounds.x + bounds.width / 2
        );

      assert.strictEqual(sideCenter, true);
    });

    it('should preserve semantic rows inside lanes', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'lane.error-handler.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const centerY = id => {
        const shape = shapes.get(id);

        return shape.y + shape.height / 2;
      };

      assert.strictEqual(centerY('StartEvent_1'), centerY('Activity_1p5dzjh'));
      assert.strictEqual(centerY('Activity_1p5dzjh'), centerY('Activity_0wlejzj'));
      assert.strictEqual(centerY('Activity_0wlejzj'), centerY('Event_1hpmzeg'));
      assert.strictEqual(centerY('Activity_182mk12'), centerY('Event_1t8lgtt'));
      assert.strictEqual(centerY('Event_1i5q0z9'), centerY('Activity_1r334k1'));
      assert.strictEqual(centerY('Activity_1r334k1'), centerY('Activity_1xlvaox'));
      assert.strictEqual(centerY('Activity_1xlvaox'), centerY('Event_03g57yi'));
    });

    it('should treat ad hoc source tasks as primary path seeds', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.ai-email-support-agent.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const process = rootElement.rootElements.find(element => {
        return element.$instanceOf('bpmn:Process');
      });
      const adHoc = process.flowElements.find(element => {
        return element.$instanceOf('bpmn:AdHocSubProcess');
      });
      const sourceTasks = adHoc.flowElements.filter(element => {
        return element.$instanceOf('bpmn:Task') &&
          !(element.incoming || []).some(flow => flow.$instanceOf('bpmn:SequenceFlow')) &&
          (element.outgoing || []).some(flow => flow.$instanceOf('bpmn:SequenceFlow'));
      });
      const edges = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement, element ]));

      assert.ok(sourceTasks.length > 1);

      for (const source of sourceTasks) {
        const outgoing = (source.outgoing || []).find(flow => {
          return flow.$instanceOf('bpmn:SequenceFlow');
        });
        const edge = edges.get(outgoing);

        assert.strictEqual(edge.waypoint.length, 2);
        assert.strictEqual(edge.waypoint[0].y, edge.waypoint[1].y);
      }
    });

    it('should preserve semantic primary paths in compact ad hoc regions', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.ai-email-support-agent.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const centerY = id => {
        const shape = shapes.get(id);

        return shape.y + shape.height / 2;
      };

      assert.strictEqual(centerY('Gateway_1whb5u5'), centerY('Activity_062h34x'));
      assert.strictEqual(centerY('Activity_062h34x'), centerY('Gateway_join_specialist'));

      for (const flowId of [ 'Flow_1mudddl', 'Flow_0j63wm9' ]) {
        const waypoints = edges.get(flowId);

        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].y, waypoints[1].y);
      }
    });

    it('should compact ad hoc flow regions and disconnected activities', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'camunda-8-tutorials.ai-agent-chat-with-mcp.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const adHoc = shapes.get('AI_Agent');
      const aspectRatio = Math.max(adHoc.width, adHoc.height) /
        Math.min(adHoc.width, adHoc.height);
      const toolXs = [ 'OpenMemory', 'Deepwiki', 'Time' ]
        .map(id => shapes.get(id).x);
      const split = shapes.get('Gateway_115zcj9');
      const confirmation = shapes.get('Activity_0mdux6v');
      const execution = shapes.get('Gateway_0fgu5ui');
      const join = shapes.get('Gateway_join_FS');
      const centerY = shape => shape.y + shape.height / 2;

      assert.ok(aspectRatio < 2);
      assert.strictEqual(new Set(toolXs).size, toolXs.length);
      assert.strictEqual(centerY(split), centerY(confirmation));
      assert.strictEqual(centerY(confirmation), centerY(execution));
      assert.strictEqual(centerY(execution), centerY(join));

      for (const flowId of [ 'Flow_19yhpei', 'Flow_0jw5z8p', 'Flow_0688ffj' ]) {
        const waypoints = edges.get(flowId);

        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].y, waypoints[1].y);
      }

      const metrics = await evaluateMetrics(output);

      assert.strictEqual(metrics.current.crossings, 0);
    });

    it('should account for gaps when packing disconnected ad hoc activities', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'camunda-8-tutorials.ai-agent-chat-with-tools.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const adHoc = shapes.get('AI_Agent');
      const tools = [
        'ListUsers',
        'Search_Recipe',
        'Jokes_API',
        'Activity_0x3prgn'
      ].map(id => shapes.get(id));

      assert.ok(Math.max(adHoc.width, adHoc.height) /
        Math.min(adHoc.width, adHoc.height) < 2);
      assert.strictEqual(new Set(tools.map(tool => tool.x)).size, 2);
      assert.strictEqual(new Set(tools.map(tool => tool.y)).size, 2);
    });

    it('should avoid proper crossings between shared endpoint channels', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'scenario.multiple-ad-hoc.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const metrics = await evaluateMetrics(output);

      assert.strictEqual(metrics.current.crossings, 0);
    });

    it('should route expanded subprocess entries and boundary handlers cleanly', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'scenario.multiple-ad-hoc.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const outer = shapes.get('Activity_1rwf2np');
      const entry = edges.get('Flow_00j0edq');
      const boundary = shapes.get('Event_0drd56l');
      const handler = shapes.get('Gateway_0o8nxv6');
      const boundaryFlow = edges.get('Flow_0jfddjt');
      const rejoin = edges.get('Flow_1gt239d');
      const alternate = edges.get('Flow_0pamxm7');

      assert.strictEqual(entry.length, 2);
      assert.strictEqual(entry[0].y, entry[1].y);
      assert.strictEqual(entry[1].x, outer.x);
      assert.deepStrictEqual(
        { x: boundaryFlow[0].x, y: boundaryFlow[0].y },
        {
          x: boundary.x + boundary.width / 2,
          y: boundary.y + boundary.height
        }
      );
      assert.strictEqual(boundaryFlow[1].x, boundaryFlow[0].x);
      assert.strictEqual(boundaryFlow[1].y, boundaryFlow[0].y + 20);
      assert.strictEqual(boundaryFlow.at(-1).x, handler.x);
      assert.strictEqual(boundaryFlow.at(-1).y, handler.y + handler.height / 2);

      for (const flow of [ rejoin, alternate ]) {
        assert.strictEqual(flow[0].x, handler.x + handler.width / 2);
        assert.strictEqual(flow[0].y, handler.y);
        assert.strictEqual(flow[1].x, flow[0].x);
        assert.ok(flow[1].y < flow[0].y);
      }
    });

    it('should fan default alternatives outward from off-spine gateways', async function() {
      const xml = fs.readFileSync(
        path.join(
          fixturesDirectory,
          'camunda-8-tutorials.insurance-personal-property-damage-claim-handling.bpmn'
        ),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const gateway = shapes.get('Gateway_0l858kt');
      const approved = shapes.get('Event_0jpjmuu');
      const declined = edges.get('Flow_0klg33h');
      const declineContinuation = edges.get('Flow_19ex45h');
      const approval = edges.get('Flow_1mww6xa');
      const approvalContinuation = edges.get('Flow_0yaksw4');

      assert.ok(approved.y < gateway.y);
      assert.strictEqual(approval[0].x, gateway.x + gateway.width / 2);
      assert.strictEqual(approval[0].y, gateway.y);
      assert.strictEqual(approval.length, 3);

      for (const flow of [ declined, declineContinuation ]) {
        assert.strictEqual(flow.length, 2);
        assert.strictEqual(flow[0].y, flow[1].y);
      }

      assert.strictEqual(approvalContinuation.length, 4);
      assert.strictEqual(approvalContinuation[0].y, approvalContinuation[1].y);
      assert.ok(approvalContinuation[1].x > approvalContinuation[0].x);
      assert.strictEqual(approvalContinuation[1].x, approvalContinuation[2].x);
      assert.ok(approvalContinuation[2].y > approvalContinuation[1].y);
    });

    it('should use task dimensions for collapsed activity containers', async function() {
      const cases = [
        [ 'sub-process.collapsed.bpmn', 'Activity_10ce7yr', null ],
        [ 'sub-process.transaction.bpmn', 'Transaction_1', null ],
        [
          'event-sub-process.basic.bpmn',
          'Activity_1ysyezl',
          xml => xml.replace('isExpanded="true"', 'isExpanded="false"')
        ],
        [
          'blueprint.capital-market-trade-exception-remediation-processing.bpmn',
          'Activity_1frnjx4',
          null
        ]
      ];

      for (const [ fixture, elementId, transform ] of cases) {
        let xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');

        if (transform) {
          xml = transform(xml);
        }

        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const shape = rootElement.diagrams
          .flatMap(diagram => diagram.plane.planeElement)
          .find(element => {
            return element.$instanceOf('bpmndi:BPMNShape') &&
              element.bpmnElement.id === elementId;
          });

        assert.deepStrictEqual(
          { width: shape.bounds.width, height: shape.bounds.height },
          { width: 100, height: 80 }
        );
      }
    });

    it('should emit visible gateway markers', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'scenario.declaration-order-ties.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const gateways = rootElement.diagrams[0].plane.planeElement.filter(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.$instanceOf('bpmn:Gateway');
      });

      assert.ok(gateways.length > 0);
      assert.ok(gateways.every(gateway => gateway.isMarkerVisible === true));
      assert.ok(gateways.every(gateway => gateway.bpmnElement.$instanceOf('bpmn:ExclusiveGateway')));
    });

    it('should tile lanes inside their participant', async function() {
      for (const fixture of [ 'lane.single.bpmn', 'lane.multiple.bpmn', 'lane.empty.bpmn' ]) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const shapes = rootElement.diagrams[0].plane.planeElement.filter(element => {
          return element.$instanceOf('bpmndi:BPMNShape');
        });
        const participant = shapes.find(shape => {
          return shape.bpmnElement.$instanceOf('bpmn:Participant');
        }).bounds;
        const lanes = shapes.filter(shape => shape.bpmnElement.$instanceOf('bpmn:Lane'))
          .map(shape => shape.bounds)
          .sort((a, b) => a.y - b.y);
        const flowNodes = shapes.filter(shape => shape.bpmnElement.$instanceOf('bpmn:FlowNode'))
          .map(shape => shape.bounds);

        assert.ok(lanes.length > 0);
        assert.strictEqual(lanes[0].x, participant.x + 30);
        assert.strictEqual(lanes[0].y, participant.y);
        assert.strictEqual(lanes[0].x + lanes[0].width, participant.x + participant.width);
        assert.strictEqual(lanes.at(-1).y + lanes.at(-1).height, participant.y + participant.height);
        assert.ok(flowNodes.every(node => node.x >= lanes[0].x + 40));
        assert.ok(flowNodes.every(node => node.x + node.width <= lanes[0].x + lanes[0].width - 40));

        for (let index = 1; index < lanes.length; index++) {
          assert.strictEqual(lanes[index].y, lanes[index - 1].y + lanes[index - 1].height);
        }
      }
    });
  });

  fs.readdirSync(fixturesDirectory)
    .filter(fileName => fileName.endsWith('.bpmn'))
    .forEach(fileName => {
      iit(fileName)(`should layout ${ fileName }`, async function() {

        // given
        const xml = fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');

        // when
        const output = await layoutProcess(xml);

        fs.writeFileSync(path.join(outputDirectory, fileName), output, 'utf8');

        if (UPDATE_SNAPSHOTS) {
          fs.writeFileSync(path.join(snapshotsDirectory, fileName), output, 'utf8');
        } else if (fs.existsSync(path.join(snapshotsDirectory, fileName))) {
          const snapshot = fs.readFileSync(path.join(snapshotsDirectory, fileName), 'utf8');

          // then
          assert.strictEqual(output, snapshot, `Snapshot does not match output for ${ fileName }`);
        }
      });
    });


  after(async function() {
    const metricsBaseline = fs.existsSync(metricsBaselineFile)
      ? JSON.parse(fs.readFileSync(metricsBaselineFile, 'utf8'))
      : {};
    const results = await Promise.all(fs.readdirSync(outputDirectory).filter(f => f.endsWith('.bpmn')).map(async fileName => {

      const diagram = fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');

      const diagramOutput = fs.readFileSync(path.join(outputDirectory, fileName), 'utf8');

      let diagramSnapshot = null;

      if (fs.existsSync(path.join(snapshotsDirectory, fileName))) {
        diagramSnapshot = fs.readFileSync(path.join(snapshotsDirectory, fileName), 'utf8');
      }

      let diagramSnapshotMatching = null;

      if (diagramSnapshot) {

        if (diagramSnapshot === diagramOutput) {
          diagramSnapshotMatching = true;
        } else {
          diagramSnapshotMatching = false;

          console.error(`Snapshot does not match output for ${ fileName }`);
        }
      }

      return {
        diagram,
        diagramOutput,
        diagramSnapshot,
        diagramSnapshotMatching,
        metrics: await evaluateMetrics(diagramOutput, metricsBaseline[fileName]),
        name: fileName
      };
    }));

    const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
    const serializedResults = Buffer.from(JSON.stringify(results)).toString('base64');

    const index = template.replace(
      /\/\* results-start \*\/[\s\S]*\/\* results-end \*\//,
      `const results = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${ serializedResults }'), character => character.charCodeAt(0))));`
    );

    fs.writeFileSync(path.join(outputDirectory, 'index.html'), index, 'utf8');
  });

  this.afterAll(() => {
    console.log('\nRun `npm run test:inspect` to inspect results.');

    console.log('\nRun `npm run test:update-snapshots` to re-build snapshots.');
  });

});


/**
 * Return the matcher for the spec of the given name.
 *
 * @param {string} fileName
 * @return {any} mochaFN
 */
function iit(fileName) {
  if (fileName.startsWith('ONLY')) {
    return it.only;
  }

  if (fileName.startsWith('SKIP')) {
    return it.skip;
  }

  return it;
}