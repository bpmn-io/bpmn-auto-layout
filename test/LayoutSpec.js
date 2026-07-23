import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import url from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';

import {
  layoutProcess as layoutProcessResult,
  LayoutWarning
} from 'bpmn-auto-layout';

import {
  getExternalLabelText,
  isExternalLabelOwner
} from '../lib/layout/BpmnUtil.js';
import { calculateStatistics } from '../tasks/benchmark-util.mjs';
import {
  EXTERNAL_LABEL_CLEARANCE,
  EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE,
  EXPANDED_SUBPROCESS_LABEL_HEIGHT,
  GROUP_PADDING,
  PARTICIPANT_HEADER_WIDTH,
  SUB_PROCESS_PADDING,
  VERTICAL_GAP
} from '../lib/layout/Constants.js';
import { evaluateMetrics } from './metrics/evaluateMetrics.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDirectory = path.join(__dirname, 'fixtures');
const failuresDirectory = path.join(fixturesDirectory, 'failures');
const outputDirectory = path.join(__dirname, 'output');
const snapshotsDirectory = path.join(__dirname, 'snapshots');
const metricsBaselineFile = path.join(__dirname, 'metrics', 'baseline.json');

const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === 'true';
const INSPECTOR_LAYOUT_TIMING_RUNS = 5;
const layoutTimingsByFixture = new Map();
const layoutWarningsByFixture = new Map();

async function layoutProcess(xml) {
  return (await layoutProcessResult(xml)).xml;
}

function getCollaborationArtifacts(rootElement) {
  const collaboration = rootElement.rootElements.find(element => {
    return element.$instanceOf('bpmn:Collaboration');
  });

 return collaboration?.artifacts || [];
}

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

    it('should route aligned link-catch continuations directly', async function() {
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
          [ source.x + source.width, source.y + source.height / 2 ],
          [ target.x, target.y + target.height / 2 ]
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

    it('should align link catch continuations until they rejoin', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'camunda-8-tutorials.capital-market-exception-processing.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const continuation = [
        'Event_19epi2t',
        'Event_004398z',
        'Gateway_0z4dryr',
        'Event_15c6fg8'
      ].map(id => {
        const shape = shapes.get(id);

        return shape.y + shape.height / 2;
      });

      assert.ok(continuation.every(y => y === continuation[0]));
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
      const boundaryLabel = topBoundary.label.bounds;
      const boundaryHost = shapes.get('Activity_0oprw8j');

      assert.ok(topBoundary.label);
      assert.ok(
        boundaryLabel.x + boundaryLabel.width <= boundaryHost.x ||
        boundaryLabel.x >= boundaryHost.x + boundaryHost.width ||
        boundaryLabel.y + boundaryLabel.height <= boundaryHost.y ||
        boundaryLabel.y >= boundaryHost.y + boundaryHost.height
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

    it('should align message flows between process nodes vertically', async function() {
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

      assert.strictEqual(edge.waypoint.length, 2);
      assert.strictEqual(edge.waypoint[0].x, source.x + source.width / 2);
      assert.strictEqual(edge.waypoint[0].y, source.y + source.height);
      assert.strictEqual(edge.waypoint.at(-1).x, target.x + target.width / 2);
      assert.strictEqual(edge.waypoint.at(-1).y, target.y);
      assert.strictEqual(edge.waypoint[0].x, edge.waypoint[1].x);
    });

    it('should preserve participant perimeter elbows during DI docking', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'collaboration.opposite-direction-message-flows.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const metrics = await evaluateMetrics(output);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const messageEdges = elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.$instanceOf('bpmn:MessageFlow');
      });
      const main = shapes.get('Participant_020kxtm');
      const upper = shapes.get('Participant_0s1a03p');
      const lower = shapes.get('Participant_0rcj6yd');
      const routeLength = messageEdges.reduce((total, edge) => {
        return total + edge.waypoint.slice(1).reduce((length, waypoint, index) => {
          const previous = edge.waypoint[index];

          return length +
            Math.abs(waypoint.x - previous.x) +
            Math.abs(waypoint.y - previous.y);
        }, 0);
      }, 0);
      const bendCount = messageEdges.reduce((total, edge) => {
        return total + Math.max(0, edge.waypoint.length - 2);
      }, 0);

      assert.strictEqual(metrics.current.nonOrthogonalConnections, 0);
      assert.ok(upper.y < main.y);
      assert.ok(main.y < lower.y);
      assert.ok(upper.x > main.x + main.width / 2);
      assert.ok(routeLength <= 1700);
      assert.ok(bendCount <= 4);
    });

    it('should reserve participant header space before process content', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.event-registration.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const participant = shapes.get('Participant_EventRegistration');
      const startEvent = shapes.get('StartEvent_Form');

      assert.ok(
        startEvent.x >=
        participant.x + PARTICIPANT_HEADER_WIDTH + SUB_PROCESS_PADDING
      );
    });

    it('should route collaboration messages around process annotations', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.event-registration.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const annotation = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.id === 'TextAnnotation_event_reg_intro';
      });
      const messageFlow = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Flow_1p4u8s4';
      });
      const association = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Association_event_reg_intro';
      });
      const segments = points => points.slice(1).map((end, index) => {
        return [ points[index], end ];
      });
      const participant = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.id === 'Participant_EventRegistration';
      });

      assert.strictEqual(messageFlow.waypoint.length, 2);
      assert.strictEqual(messageFlow.waypoint[0].x, messageFlow.waypoint[1].x);
      assert.ok(
        annotation.bounds.x + annotation.bounds.width <= participant.bounds.x
      );
      assert.ok(annotation.bounds.y < participant.bounds.y + participant.bounds.height);
      assert.ok(annotation.bounds.y + annotation.bounds.height > participant.bounds.y);

      for (const [ start, end ] of segments(messageFlow.waypoint)) {
        const crossesInterior = start.x === end.x
          ? start.x > annotation.bounds.x &&
            start.x < annotation.bounds.x + annotation.bounds.width &&
            Math.max(start.y, end.y) > annotation.bounds.y &&
            Math.min(start.y, end.y) < annotation.bounds.y + annotation.bounds.height
          : start.y > annotation.bounds.y &&
            start.y < annotation.bounds.y + annotation.bounds.height &&
            Math.max(start.x, end.x) > annotation.bounds.x &&
            Math.min(start.x, end.x) < annotation.bounds.x + annotation.bounds.width;

        assert.strictEqual(crossesInterior, false);
      }

      for (const [ messageStart, messageEnd ] of segments(messageFlow.waypoint)) {
        for (const [ associationStart, associationEnd ] of segments(association.waypoint)) {
          const collinearOverlap = messageStart.x === messageEnd.x &&
              associationStart.x === associationEnd.x &&
              messageStart.x === associationStart.x
            ? Math.min(messageStart.y, messageEnd.y) <
                Math.max(associationStart.y, associationEnd.y) &&
              Math.min(associationStart.y, associationEnd.y) <
                Math.max(messageStart.y, messageEnd.y)
            : messageStart.y === messageEnd.y &&
              associationStart.y === associationEnd.y &&
              messageStart.y === associationStart.y &&
              Math.min(messageStart.x, messageEnd.x) <
                Math.max(associationStart.x, associationEnd.x) &&
              Math.min(associationStart.x, associationEnd.x) <
                Math.max(messageStart.x, messageEnd.x);

          assert.strictEqual(collinearOverlap, false);
        }
      }
    });

    it('should route message flows to collapsed subprocesses', async function() {
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
          element.bpmnElement.id === 'Flow_193bw3h';
      });
      const source = shapes.get('Participant_1qdn8qg');
      const targetParticipant = shapes.get('Participant_0dwrwgx');
      const target = shapes.get('Activity_0qw608m');

      assert.ok(!shapes.has('Event_0m9ntx1'));
      assert.strictEqual(edge.waypoint[0].x, target.x + target.width / 2);
      assert.strictEqual(edge.waypoint[0].y, source.y);
      assert.strictEqual(edge.waypoint.at(-1).x, target.x + target.width / 2);
      assert.strictEqual(edge.waypoint.at(-1).y, target.y + target.height);
      assert.strictEqual(
        source.y - targetParticipant.y - targetParticipant.height,
        VERTICAL_GAP
      );
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

    it('should align message endpoints by translating participants', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'process.application-processing.bpmn'),
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
      const straightMessageFlows = elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.$instanceOf('bpmn:MessageFlow') &&
          element.waypoint.length === 2;
      });
      const assessmentReturn = edges.get(
        'sid-B28E079A-EC0B-4A89-9BF3-6850173FADFC'
      );

      assert.ok(straightMessageFlows.length >= 22);
      assert.strictEqual(assessmentReturn.length, 2);
      assert.strictEqual(assessmentReturn[0].x, assessmentReturn[1].x);

      assert.strictEqual(
        shapes.get('sid-2E859D5D-83B3-461D-9FFF-2AAF49E71D2A').y,
        shapes.get('sid-EEF891AC-F8A7-4623-9BA3-F560E2782C9D').y
      );
      assert.strictEqual(
        shapes.get('sid-A280AE73-E103-45BC-8078-8ADB6A8AF29C').x,
        shapes.get('sid-527C14AA-A993-4E8C-A9CD-99639DF62466').x
      );
      assert.strictEqual(
        shapes.get('sid-A280AE73-E103-45BC-8078-8ADB6A8AF29C').x,
        shapes.get('sid-187453C6-5AB5-4A6D-9A62-BF537E04EA0D').x
      );

      const candidateNotification = edges.get(
        'sid-37532634-B172-4542-96A6-7E347E3CEA37'
      );
      const candidateNotificationLength = candidateNotification
        .slice(1)
        .reduce((length, waypoint, index) => {
          const previous = candidateNotification[index];

          return length +
            Math.abs(waypoint.x - previous.x) +
            Math.abs(waypoint.y - previous.y);
        }, 0);

      assert.ok(candidateNotificationLength < 2500);
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

    it('should size empty process participants around message docks', async function() {
      const xml = fs.readFileSync(
        path.join(
          fixturesDirectory,
          'collaboration.message-flows-to-empty-process.bpmn'
        ),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const participantShapes = new Map(elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.$instanceOf('bpmn:Participant');
      }).map(element => [ element.bpmnElement.id, element.bounds ]));
      const participant = participantShapes.get('Participant_01ttr04');
      const messageFlows = elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.$instanceOf('bpmn:MessageFlow');
      });

      assert.ok(participant.width > 300);
      assert.ok(
        participant.x > participantShapes.get('Participant_1l36cxe').x
      );

      for (const edge of messageFlows) {
        const participantDock = edge.bpmnElement.sourceRef.id === 'Participant_01ttr04'
          ? edge.waypoint[0]
          : edge.waypoint.at(-1);

        assert.ok(participantDock.x >= participant.x);
        assert.ok(participantDock.x <= participant.x + participant.width);
        assert.strictEqual(edge.waypoint.length, 2);
        assert.strictEqual(edge.waypoint[0].x, edge.waypoint[1].x);
      }
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

    it('should keep data artifacts clear of sequence flows', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'data-object-and-store.basic.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const artifacts = elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNShape') && (
          element.bpmnElement.$instanceOf('bpmn:DataObjectReference') ||
          element.bpmnElement.$instanceOf('bpmn:DataStoreReference')
        );
      });
      const sequenceFlows = elements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.$instanceOf('bpmn:SequenceFlow');
      });

      for (const { bounds } of artifacts) {
        for (const { waypoint } of sequenceFlows) {
          for (let index = 1; index < waypoint.length; index++) {
            const start = waypoint[index - 1];
            const end = waypoint[index];
            const crossesInterior = start.x === end.x
              ? start.x > bounds.x &&
                start.x < bounds.x + bounds.width &&
                Math.max(start.y, end.y) > bounds.y &&
                Math.min(start.y, end.y) < bounds.y + bounds.height
              : start.y > bounds.y &&
                start.y < bounds.y + bounds.height &&
                Math.max(start.x, end.x) > bounds.x &&
                Math.min(start.x, end.x) < bounds.x + bounds.width;

            assert.strictEqual(crossesInterior, false);
          }
        }
      }
    });

    it('should keep artifacts clear across semantic scopes', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.servicenow-integration-blueprint.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const artifactShapes = rootElement.diagrams[0].plane.planeElement.filter(element => {
        return element.$instanceOf('bpmndi:BPMNShape') && (
          element.bpmnElement.$instanceOf('bpmn:TextAnnotation') ||
          element.bpmnElement.$instanceOf('bpmn:DataObjectReference') ||
          element.bpmnElement.$instanceOf('bpmn:DataStoreReference')
        );
      });
      const annotations = artifactShapes.filter(element => {
        return element.bpmnElement.$instanceOf('bpmn:TextAnnotation');
      });
      const otherArtifacts = artifactShapes.filter(element => {
        return !element.bpmnElement.$instanceOf('bpmn:TextAnnotation');
      });

      for (const annotation of annotations) {
        for (const artifact of otherArtifacts) {
          const overlaps = annotation.bounds.x <
              artifact.bounds.x + artifact.bounds.width &&
            artifact.bounds.x <
              annotation.bounds.x + annotation.bounds.width &&
            annotation.bounds.y <
              artifact.bounds.y + artifact.bounds.height &&
            artifact.bounds.y <
              annotation.bounds.y + annotation.bounds.height;

          assert.strictEqual(overlaps, false, [
            annotation.bpmnElement.id,
            artifact.bpmnElement.id
          ].join(' / '));
        }
      }
    });

    it('should route artifact associations without bendpoints', async function() {
      for (const fixture of [
        'camunda-8-tutorials.order-fulfillment.bpmn',
        'camunda-8-tutorials.ai-agent-chat-with-tools.bpmn'
      ]) {
        const xml = fs.readFileSync(path.join(fixturesDirectory, fixture), 'utf8');
        const output = await layoutProcess(xml);
        const { rootElement } = await new BpmnModdle().fromXML(output);
        const associations = rootElement.diagrams[0].plane.planeElement.filter(element => {
          return element.$instanceOf('bpmndi:BPMNEdge') &&
            element.bpmnElement.$instanceOf('bpmn:Association');
        });

        assert.ok(associations.length > 0);
        assert.ok(associations.every(edge => edge.waypoint.length === 2), fixture);
      }
    });

    it('should place tool annotations directly below their owner', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'camunda-8-tutorials.ai-agent-chat-with-tools.bpmn'),
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
          element.bpmnElement.id === 'Association_1bz0b4g';
      });
      const task = shapes.get('Jokes_API');
      const annotation = shapes.get('TextAnnotation_01jo4ud');

      assert.ok(annotation.y >= task.y + task.height);
      assert.strictEqual(edge.waypoint[0].x, edge.waypoint[1].x);
    });

    it('should associate parent-scope annotations with expanded subprocess contents', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'text-annotation.expanded-subprocess.bpmn'),
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
          element.bpmnElement.id === 'Association_002a1rl';
      });

      const task = shapes.get('Activity_1mn3r19');
      const annotation = shapes.get('TextAnnotation_0422590');
      const isOnBoundary = (point, bounds) => {
        const withinHorizontalBounds = point.x >= bounds.x && point.x <= bounds.x + bounds.width;
        const withinVerticalBounds = point.y >= bounds.y && point.y <= bounds.y + bounds.height;

        return (
          (withinHorizontalBounds && (point.y === bounds.y || point.y === bounds.y + bounds.height)) ||
          (withinVerticalBounds && (point.x === bounds.x || point.x === bounds.x + bounds.width))
        );
      };

      assert.ok(task);
      assert.ok(annotation);
      assert.ok(edge);
      assert.ok(edge.waypoint.length >= 2);
      assert.ok(isOnBoundary(edge.waypoint[0], task));
      assert.ok(isOnBoundary(edge.waypoint.at(-1), annotation));
    });

    it('should emit labels for named external-label owners in every plane', async function() {
      const xml = fs.readFileSync(
        path.join(
          fixturesDirectory,
          'blueprint.capital-market-trade-exception-remediation-processing.bpmn'
        ),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const diagrams = rootElement.diagrams;

      assert.ok(diagrams.length > 1);

      for (const diagram of diagrams) {
        for (const di of diagram.plane.planeElement) {
          const element = di.bpmnElement;

          if (!isExternalLabelOwner(element) ||
              !getExternalLabelText(element).trim()) {
            continue;
          }

          assert.ok(di.label, `${element.id} should have explicit label DI`);
        }
      }
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

    it('should route sequence flows across intervening lanes', async function() {
      const xml = fs.readFileSync(path.join(fixturesDirectory, 'lane.skipping-lanes.bpmn'), 'utf8');
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const shapes = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const edges = new Map(elements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element ]));
      const flowIds = [ 'Flow_1lf50qy', 'Flow_04isu9o', 'Flow_1h8ne59', 'Flow_0z6vw5i' ];
      const skippingFlowIds = [ 'Flow_1lf50qy', 'Flow_0z6vw5i' ];
      const laneIds = [ 'Lane_1aqmqfw', 'Lane_1lthzsc', 'Lane_0ejty5h' ];
      const laneMembership = new Map([
        [ 'StartEvent_1', 'Lane_1aqmqfw' ],
        [ 'Event_09mzq9k', 'Lane_1aqmqfw' ],
        [ 'Activity_0a9f0ti', 'Lane_1lthzsc' ],
        [ 'Activity_01w7lv4', 'Lane_0ejty5h' ],
        [ 'Activity_0p343mz', 'Lane_0ejty5h' ]
      ]);

      assert.ok(flowIds.every(flowId => edges.has(flowId)));

      for (const edge of edges.values()) {
        assert.ok(edge.waypoint.every((point, index) => {
          if (index === 0) {
            return true;
          }

          const previous = edge.waypoint[index - 1];

          return point.x === previous.x || point.y === previous.y;
        }));
      }

      for (const flowId of skippingFlowIds) {
        const edge = edges.get(flowId);
        const source = shapes.get(edge.bpmnElement.sourceRef.id);
        const target = shapes.get(edge.bpmnElement.targetRef.id);
        const start = edge.waypoint[0];
        const afterStart = edge.waypoint[1];
        const beforeEnd = edge.waypoint.at(-2);
        const end = edge.waypoint.at(-1);
        const startsOutward =
          (start.y === source.y && afterStart.y < start.y) ||
          (start.y === source.y + source.height && afterStart.y > start.y) ||
          (start.x === source.x && afterStart.x < start.x) ||
          (start.x === source.x + source.width && afterStart.x > start.x);
        const endsOutward =
          (end.y === target.y && beforeEnd.y < end.y) ||
          (end.y === target.y + target.height && beforeEnd.y > end.y) ||
          (end.x === target.x && beforeEnd.x < end.x) ||
          (end.x === target.x + target.width && beforeEnd.x > end.x);

        assert.ok(startsOutward);
        assert.ok(endsOutward);
      }

      for (const [ nodeId, laneId ] of laneMembership) {
        const node = shapes.get(nodeId);
        const lane = shapes.get(laneId);

        assert.ok(node.x >= lane.x);
        assert.ok(node.y >= lane.y);
        assert.ok(node.x + node.width <= lane.x + lane.width);
        assert.ok(node.y + node.height <= lane.y + lane.height);
      }

      const participant = shapes.get('Participant_0ii8jx1');

      for (const laneId of laneIds) {
        const lane = shapes.get(laneId);

        assert.ok(lane.x >= participant.x);
        assert.ok(lane.y >= participant.y);
        assert.ok(lane.x + lane.width <= participant.x + participant.width);
        assert.ok(lane.y + lane.height <= participant.y + participant.height);
      }

      const metrics = await evaluateMetrics(output);

      assert.strictEqual(metrics.current.edgeShapeIntersections, 0);
      assert.strictEqual(metrics.current.wrongWayDockings, 0);
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
      const planeElements = rootElement.diagrams[0].plane.planeElement;
      const edges = new Map(planeElements
        .filter(element => element.$instanceOf('bpmndi:BPMNEdge'))
        .map(element => [ element.bpmnElement.id, element.waypoint ]));
      const centerY = id => {
        const shape = shapes.get(id);

        return shape.y + shape.height / 2;
      };

      assert.strictEqual(centerY('Gateway_1whb5u5'), centerY('Activity_062h34x'));
      assert.strictEqual(centerY('Activity_062h34x'), centerY('Gateway_join_specialist'));

      const subprocess = planeElements.find(element => {
        return element.bpmnElement.id === 'Activity_04glkkx';
      });
      const gateway = planeElements.find(element => {
        return element.bpmnElement.id === 'Gateway_1whb5u5';
      });
      const childShapes = planeElements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.$parent === subprocess.bpmnElement &&
          !element.bpmnElement.$instanceOf('bpmn:BoundaryEvent');
      });
      const titleBottom = subprocess.bounds.y + EXPANDED_SUBPROCESS_LABEL_HEIGHT;
      const reservedTop = subprocess.bounds.y +
        SUB_PROCESS_PADDING +
        EXPANDED_SUBPROCESS_LABEL_HEIGHT;

      assert.ok(gateway.label.bounds.y >= titleBottom);
      assert.strictEqual(
        gateway.bounds.y -
          (gateway.label.bounds.y + gateway.label.bounds.height),
        EXTERNAL_LABEL_CLEARANCE
      );
      assert.ok(childShapes.every(shape => shape.bounds.y >= reservedTop));

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
      const annotation = shapes.get('TextAnnotation_1rkjf45');

      assert.ok(aspectRatio < 2);
      assert.strictEqual(new Set(toolXs).size, toolXs.length);
      assert.strictEqual(centerY(split), centerY(confirmation));
      assert.strictEqual(centerY(confirmation), centerY(execution));
      assert.strictEqual(centerY(execution), centerY(join));
      assert.ok(annotation.x >= adHoc.x);
      assert.ok(annotation.y >= adHoc.y);
      assert.ok(annotation.x + annotation.width <= adHoc.x + adHoc.width);
      assert.ok(annotation.y + annotation.height <= adHoc.y + adHoc.height);

      for (const flowId of [ 'Flow_19yhpei', 'Flow_0jw5z8p', 'Flow_0688ffj' ]) {
        const waypoints = edges.get(flowId);

        assert.strictEqual(waypoints.length, 2);
        assert.strictEqual(waypoints[0].y, waypoints[1].y);
      }

      const metrics = await evaluateMetrics(output);

      assert.strictEqual(metrics.current.crossings, 0);
    });

    it('should leave text annotations clear of expanded subprocess borders', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.communication-agent.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const subProcess = shapes.get('Activity_CommunicationAgent');
      const annotation = shapes.get('TextAnnotation_1dtxdbk');

      assert.ok(
        annotation.x >= subProcess.x + subProcess.width +
          EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE
      );
    });

    it('should derive group bounds from explicit members', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'artifact.group.bpmn'),
        'utf8'
      );
      const result = await layoutProcessResult(xml);
      const output = result.xml;
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const elements = rootElement.diagrams[0].plane.planeElement;
      const group = elements.find(element => {
        return element.bpmnElement.$instanceOf('bpmn:Group');
      });
      const categoryValue = group.bpmnElement.categoryValueRef;
      const members = elements.filter(element => {
        const references = element.bpmnElement.categoryValueRef;

        return Array.isArray(references) &&
          references.some(reference => reference === categoryValue);
      });
      const points = members.flatMap(member => {
        if (member.bounds) {
          return [
            { x: member.bounds.x, y: member.bounds.y },
            {
              x: member.bounds.x + member.bounds.width,
              y: member.bounds.y + member.bounds.height
            }
          ];
        }

        return member.waypoint || [];
      });
      const minX = Math.min(...points.map(point => point.x));
      const minY = Math.min(...points.map(point => point.y));
      const maxX = Math.max(...points.map(point => point.x));
      const maxY = Math.max(...points.map(point => point.y));

      assert.ok(members.length > 0);
      assert.deepStrictEqual(
        {
          x: group.bounds.x,
          y: group.bounds.y,
          width: group.bounds.width,
          height: group.bounds.height
        },
        {
          x: minX - GROUP_PADDING,
          y: minY - GROUP_PADDING,
          width: maxX - minX + 2 * GROUP_PADDING,
          height: maxY - minY + 2 * GROUP_PADDING
        }
      );
      assert.strictEqual(
        group.bounds.y -
          (group.label.bounds.y + group.label.bounds.height),
        EXTERNAL_LABEL_CLEARANCE
      );
      assert.deepStrictEqual(result.warnings, []);
    });

    it('should warn when a group has no visible explicit members', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'artifact.group-without-members.bpmn'),
        'utf8'
      );
      const result = await layoutProcessResult(xml);
      const { rootElement } = await new BpmnModdle().fromXML(result.xml);
      const group = rootElement.diagrams[0].plane.planeElement.find(element => {
        return element.bpmnElement.$instanceOf('bpmn:Group');
      });

      assert.ok(typeof result.xml === 'string');
      assert.strictEqual(group, undefined);
      assert.strictEqual(result.warnings.length, 1);
      assert.ok(result.warnings[0] instanceof LayoutWarning);
      assert.deepStrictEqual(
        {
          code: result.warnings[0].code,
          elementId: result.warnings[0].elementId,
          relatedElementIds: result.warnings[0].relatedElementIds
        },
        {
          code: 'GROUP_MEMBERS_NOT_FOUND',
          elementId: 'Group_0z7n6ui',
          relatedElementIds: []
        }
      );
    });

    it('should lay out collaboration artifacts', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'artifact.collaboration-association.bpmn'),
        'utf8'
      );
      const { rootElement } = await new BpmnModdle().fromXML(xml);
      const result = await layoutProcessResult(xml);
      const { rootElement: outputRoot } = await new BpmnModdle().fromXML(result.xml);
      const artifacts = getCollaborationArtifacts(rootElement);
      const annotation = artifacts.find(element => {
        return element.$instanceOf('bpmn:TextAnnotation');
      });
      const association = artifacts.find(element => {
        return element.$instanceOf('bpmn:Association');
      });
      const elements = outputRoot.diagrams[0].plane.planeElement;
      const annotationShape = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.id === annotation.id;
      });
      const associationEdge = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === association.id;
      });
      const participantShape = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.$instanceOf('bpmn:Participant');
      });
      const annotationBounds = annotationShape.bounds;
      const participantBounds = participantShape.bounds;
      const ownerShape = elements.find(element => {
        return element.$instanceOf('bpmndi:BPMNShape') &&
          element.bpmnElement.id === 'Activity_0djri8w';
      });
      const ownerBounds = ownerShape.bounds;

      assert.deepStrictEqual(
        artifacts.map(element => element.$type),
        [ 'bpmn:TextAnnotation', 'bpmn:Association' ]
      );
      assert.ok(annotationShape);
      assert.ok(associationEdge);
      assert.ok(annotationBounds.y + annotationBounds.height <= participantBounds.y);
      assert.deepStrictEqual(associationEdge.waypoint.map(({ x, y }) => ({ x, y })), [
        {
          x: ownerBounds.x + ownerBounds.width / 2,
          y: ownerBounds.y
        },
        {
          x: annotationBounds.x + annotationBounds.width / 2,
          y: annotationBounds.y + annotationBounds.height
        }
      ]);
      assert.deepStrictEqual(result.warnings, []);
    });

    it('should keep collaboration annotations clear of containers and flows', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'camunda-8-tutorials.order-fulfillment.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const planeElements = rootElement.diagrams[0].plane.planeElement;
      const shapeElements = planeElements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNShape');
      });
      const shapes = new Map(shapeElements
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const participants = shapeElements.filter(element => {
        return element.bpmnElement.$instanceOf('bpmn:Participant');
      }).map(element => element.bounds);
      const annotations = shapeElements.filter(element => {
        return element.bpmnElement.$instanceOf('bpmn:TextAnnotation');
      }).map(element => element.bounds);
      const flowEdges = planeElements.filter(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') && (
          element.bpmnElement.$instanceOf('bpmn:SequenceFlow') ||
          element.bpmnElement.$instanceOf('bpmn:MessageFlow')
        );
      });
      const overlaps = (a, b) => {
        return a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
      };
      const isInside = (inner, outer) => {
        return inner.x >= outer.x &&
          inner.y >= outer.y &&
          inner.x + inner.width <= outer.x + outer.width &&
          inner.y + inner.height <= outer.y + outer.height;
      };
      for (const annotationId of [
        'TextAnnotation_05h8woc',
        'TextAnnotation_0gbm3kr',
        'TextAnnotation_048ucyh',
        'TextAnnotation_0nn4nw5'
      ]) {
        const annotation = shapes.get(annotationId);

        assert.ok(participants.every(participant => {
          return !overlaps(annotation, participant);
        }), annotationId);
      }

      for (const annotation of annotations) {
        for (const participant of participants) {
          assert.ok(
            isInside(annotation, participant) || !overlaps(annotation, participant)
          );
          assert.strictEqual(overlaps(annotation, {
            x: participant.x,
            y: participant.y,
            width: 30,
            height: participant.height
          }), false);
        }

        for (const edge of flowEdges) {
          for (let index = 1; index < edge.waypoint.length; index++) {
            const start = edge.waypoint[index - 1];
            const end = edge.waypoint[index];
            const crossesInterior = start.x === end.x
              ? start.x > annotation.x &&
                start.x < annotation.x + annotation.width &&
                Math.max(start.y, end.y) > annotation.y &&
                Math.min(start.y, end.y) < annotation.y + annotation.height
              : start.y > annotation.y &&
                start.y < annotation.y + annotation.height &&
                Math.max(start.x, end.x) > annotation.x &&
                Math.min(start.x, end.x) < annotation.x + annotation.width;

            assert.strictEqual(crossesInterior, false);
          }
        }
      }
    });

    it('should keep process annotations clear of their future participant edge', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'blueprint.car-rental-booking-process.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const shapes = new Map(rootElement.diagrams[0].plane.planeElement
        .filter(element => element.$instanceOf('bpmndi:BPMNShape'))
        .map(element => [ element.bpmnElement.id, element.bounds ]));
      const annotation = shapes.get('TextAnnotation_car_rental_intro');
      const participant = shapes.get('Participant_0gpkl5f');
      const overlaps = annotation.x < participant.x + participant.width &&
        participant.x < annotation.x + annotation.width &&
        annotation.y < participant.y + participant.height &&
        participant.y < annotation.y + annotation.height;
      const inside = annotation.x >= participant.x &&
        annotation.y >= participant.y &&
        annotation.x + annotation.width <= participant.x + participant.width &&
        annotation.y + annotation.height <= participant.y + participant.height;

      assert.ok(inside || !overlaps);
    });

    it('should prefer a near-shortest straight annotation association', async function() {
      const xml = fs.readFileSync(
        path.join(fixturesDirectory, 'camunda-8-tutorials.absence-request.bpmn'),
        'utf8'
      );
      const output = await layoutProcess(xml);
      const { rootElement } = await new BpmnModdle().fromXML(output);
      const association = rootElement.diagrams[0].plane.planeElement.find(element => {
        return element.$instanceOf('bpmndi:BPMNEdge') &&
          element.bpmnElement.id === 'Association_absence_intro';
      });
      const waypoints = association.waypoint;

      assert.ok(
        waypoints.every(({ x }) => x === waypoints[0].x) ||
        waypoints.every(({ y }) => y === waypoints[0].y)
      );
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
        await layoutProcessResult(xml);

        const timings = [];
        let output;
        let warnings;

        for (let index = 0; index < INSPECTOR_LAYOUT_TIMING_RUNS; index++) {
          const startedAt = performance.now();
          const result = await layoutProcessResult(xml);

          timings.push(performance.now() - startedAt);

          if (index === 0) {
            output = result.xml;
            warnings = result.warnings;
          }
        }

        layoutTimingsByFixture.set(fileName, timings);
        layoutWarningsByFixture.set(fileName, warnings.map(warning => ({
          code: warning.code,
          elementId: warning.elementId,
          message: warning.message,
          relatedElementIds: warning.relatedElementIds
        })));

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
    const layoutTimingSummary = summarizeLayoutTimings(layoutTimingsByFixture);
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
        layoutTiming: layoutTimingSummary.get(fileName) || null,
        metrics: await evaluateMetrics(diagramOutput, metricsBaseline[fileName]),
        name: fileName,
        warnings: layoutWarningsByFixture.get(fileName) || []
      };
    }));

    const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
    const serializedResults = Buffer.from(JSON.stringify(results)).toString('base64');

    const index = template.replace(
      /\/\* results-start \*\/[\s\S]*\/\* results-end \*\//,
      `const results = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${ serializedResults }'), character => character.charCodeAt(0))));`
    );

    assert.ok(index.includes('createMetricsPanel'));
    assert.ok(index.includes('createLayoutTiming'));
    assert.ok(index.includes('createWarningsPanel'));
    assert.ok(results.every(result => {
      return Number.isFinite(result.layoutTiming?.averageMs) &&
        result.layoutTiming.averageMs >= 0 &&
        Number.isFinite(result.layoutTiming.p50Ms) &&
        result.layoutTiming.p50Ms >= 0 &&
        Number.isFinite(result.layoutTiming.p90Ms) &&
        result.layoutTiming.p90Ms >= 0 &&
        result.layoutTiming.runs === INSPECTOR_LAYOUT_TIMING_RUNS;
    }));
    assert.deepStrictEqual(
      results
        .map(result => result.layoutTiming.rank)
        .sort((first, second) => first - second),
      results.map((result, index) => index + 1)
    );
    const groupWarningFixture = results.find(result => {
      return result.name === 'artifact.group-without-members.bpmn';
    });
    const collaborationArtifactWarningFixture = results.find(result => {
      return result.name === 'artifact.collaboration-association.bpmn';
    });

    if (groupWarningFixture) {
      assert.deepStrictEqual(
        groupWarningFixture.warnings,
        [ {
          code: 'GROUP_MEMBERS_NOT_FOUND',
          elementId: 'Group_0z7n6ui',
          message: 'Group Group_0z7n6ui has no visible explicitly referenced members and was omitted.',
          relatedElementIds: []
        } ]
      );
    }

    if (collaborationArtifactWarningFixture) {
      assert.deepStrictEqual(collaborationArtifactWarningFixture.warnings, []);
    }
    assert.ok(index.includes('branchSymmetry'));
    assert.ok(index.includes('labelEdgeOverlaps'));
    assert.ok(index.includes('metric-filter-badges'));
    assert.ok(index.includes('metricFilterCounts'));
    assert.ok(index.includes('hasMetricFilterResults'));
    assert.ok(index.includes('metric.disabled = !hasMetricFilterResults(definition.key)'));
    assert.ok(index.includes('id="sort-by"'));
    assert.ok(index.includes('id="sort-direction"'));
    assert.ok(index.includes('sortableMetricDefinitions'));
    assert.ok(index.includes('sortFixturePanels'));
    assert.ok(index.includes('sortDirection'));
    assert.ok(index.includes('warning-filter-badge'));
    assert.ok(index.includes('warningFilterCount'));
    assert.ok(index.includes('isWarningVisible'));
    assert.ok(index.includes('>Passed '));
    assert.ok(index.includes('>Failed '));
    assert.ok(index.includes('>New '));
    assert.ok(
      index.indexOf('id="warning-filter-badge"') <
      index.indexOf('id="metric-filter-badges"')
    );
    assert.ok(index.includes('createMetricHighlighter'));
    assert.ok(index.includes('for (const metric of activeMetricFilters)'));
    assert.ok(index.includes("outputViewer.on('canvas.viewbox.changing', syncSnapshotViewport)"));
    assert.ok(index.includes("outputViewer.on('canvas.viewbox.changed', syncSnapshotViewport)"));
    assert.ok(index.includes('snapshotViewport.setAttribute('));

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

function summarizeLayoutTimings(timingsByFixture) {
  const timings = [ ...timingsByFixture.entries() ].map(([ fileName, durations ]) => {
    return [ fileName, calculateStatistics(durations) ];
  }).sort(([ firstName, firstStatistics ], [ secondName, secondStatistics ]) => {
    return secondStatistics.p50Ms - firstStatistics.p50Ms ||
      firstName.localeCompare(secondName);
  });
  const p50s = timings
    .map(([, statistics ]) => statistics.p50Ms)
    .sort((first, second) => first - second);
  const midpoint = Math.floor(p50s.length / 2);
  const medianP50Ms = p50s.length % 2
    ? p50s[midpoint]
    : (p50s[midpoint - 1] + p50s[midpoint]) / 2;
  const slowCount = Math.max(1, Math.ceil(timings.length * 0.1));

  return new Map(timings.map(([ fileName, statistics ], index) => {
    return [ fileName, {
      ...statistics,
      isSlow: index < slowCount,
      medianP50Ms,
      rank: index + 1,
      runs: INSPECTOR_LAYOUT_TIMING_RUNS,
      total: timings.length
    } ];
  }));
}