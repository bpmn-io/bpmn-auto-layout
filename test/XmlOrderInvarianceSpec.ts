import assert from "node:assert";
import { readFile } from "node:fs/promises";

import { BpmnModdle } from "bpmn-moddle";
import { describe, it } from "mocha";

import { layoutProcess } from "bpmn-auto-layout";

import { isBpmndiType } from "../lib/layout/bpmn/Types.js";
import { evaluateMetrics, hasBandADefect } from "./metrics/evaluateMetrics.js";
import {
	reorderFlowElements,
	XML_ORDER_CORE_VARIANTS,
} from "../tasks/xml-order-variants.js";

import type { BpmnElement } from "../lib/layout/bpmn/Types.js";

type Bounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};
type Waypoint = {
	x: number;
	y: number;
};

const FIXTURE = "expanded-subprocess-retry-loop.bpmn";
const RETRY_ID = "Activity_1rcdusb";
const SUBPROCESS_ID = "Activity_0jyy09f";
const ENTRY_GATEWAY_ID = "Gateway_01mjb0r";
const EXIT_GATEWAY_ID = "Gateway_10bvoyq";
const GATEWAY_FIXTURE = "gateway.multiple.bpmn";
const FINSERV_FIXTURE = "camunda-consulting.finserv-loan-kyc.bpmn";
const DISCONNECTED_COMPONENT_FIXTURE = "scenario.disconnected-components.bpmn";
const LINK_CONTINUATION_FIXTURE = "link-event.throw-catch.bpmn";
const GATEWAY_SPINE_FLOW_IDS = [
	"Flow_174mdxz",
	"Flow_0x21408",
	"Flow_1825yj3",
	"Flow_0lt2wxp",
	"Flow_1ge6e6x",
];
const variants = [
	...XML_ORDER_CORE_VARIANTS,
	{
		name: "subprocess-before-retry",
		reorder: swapRetryAndSubprocess,
	},
];

describe("XML order invariance", function () {
	it("should stack disconnected components independently of XML declaration order", async function () {
		const xml = await readFile(
			new URL(`fixtures/${DISCONNECTED_COMPONENT_FIXTURE}`, import.meta.url),
			"utf8",
		);
		let componentOrder: string[] | null = null;

		for (const variant of XML_ORDER_CORE_VARIANTS) {
			const output = (
				await layoutProcess(await reorderFlowElements(xml, variant))
			).xml;
			const shapes = await readShapes(output);
			const order = ["StartEvent_1", "Activity_15ig4z7"].sort((a, b) => {
				return getRequired(shapes.get(a)).y - getRequired(shapes.get(b)).y;
			});

			componentOrder ||= order;
			assert.deepStrictEqual(
				order,
				componentOrder,
				`${variant.name} should retain disconnected component stacking`,
			);
		}

		assert.deepStrictEqual(componentOrder, ["Activity_15ig4z7", "StartEvent_1"]);
	});

	it("should stack link throw components before catch continuations", async function () {
		const xml = await readFile(
			new URL(`fixtures/${LINK_CONTINUATION_FIXTURE}`, import.meta.url),
			"utf8",
		);

		for (const variant of XML_ORDER_CORE_VARIANTS) {
			const output = (
				await layoutProcess(await reorderFlowElements(xml, variant))
			).xml;
			const shapes = await readShapes(output);

			assert.ok(
				getRequired(shapes.get("Event_0za4bxa")).y <
					getRequired(shapes.get("Event_07kykhm")).y,
				`${variant.name} should place the throw side before the catch continuation`,
			);
		}
	});

	it("should retain the expanded subprocess spine through order variants", async function () {
		const xml = await readFile(
			new URL(`fixtures/${FIXTURE}`, import.meta.url),
			"utf8",
		);

		for (const variant of variants) {
			const variantXml = await reorderFlowElements(xml, variant);
			const output = (await layoutProcess(variantXml)).xml;
			const shapes = await readShapes(output);
			const centerY = (id: string): number => {
				const shape = getRequired(shapes.get(id));

				return shape.y + shape.height / 2;
			};
			const metrics = await evaluateMetrics(output);

			assert.strictEqual(
				centerY(ENTRY_GATEWAY_ID),
				centerY(SUBPROCESS_ID),
				`${variant.name} should keep the subprocess on the entry spine`,
			);
			assert.strictEqual(
				centerY(SUBPROCESS_ID),
				centerY(EXIT_GATEWAY_ID),
				`${variant.name} should keep the subprocess on the exit spine`,
			);
			assert.ok(
				getRequired(shapes.get(RETRY_ID)).y >
					getRequired(shapes.get(SUBPROCESS_ID)).y,
				`${variant.name} should place the retry loop below the subprocess`,
			);
			assert.strictEqual(
				metrics.error,
				null,
				`${variant.name} should produce metrics`,
			);
			assert.strictEqual(
				hasBandADefect(metrics),
				false,
				`${variant.name} should not introduce a hard geometry defect`,
			);
		}
	});

	it("should retain the completing gateway path through order variants", async function () {
		const xml = await readFile(
			new URL(`fixtures/${GATEWAY_FIXTURE}`, import.meta.url),
			"utf8",
		);

		for (const variant of XML_ORDER_CORE_VARIANTS) {
			const output = (
				await layoutProcess(await reorderFlowElements(xml, variant))
			).xml;
			const edges = await readEdges(output);
			const metrics = await evaluateMetrics(output);

			for (const flowId of GATEWAY_SPINE_FLOW_IDS) {
				const waypoints = getRequired(edges.get(flowId));

				assert.strictEqual(
					waypoints.length,
					2,
					`${variant.name} should route ${flowId} directly`,
				);
				assert.strictEqual(
					waypoints[0].y,
					waypoints[1].y,
					`${variant.name} should keep ${flowId} on the horizontal spine`,
				);
			}

			assert.strictEqual(
				hasBandADefect(metrics),
				false,
				`${variant.name} should not introduce a hard geometry defect`,
			);
		}
	});

	it("should bound Finserv complexity through order variants", async function () {
		const xml = await readFile(
			new URL(`fixtures/${FINSERV_FIXTURE}`, import.meta.url),
			"utf8",
		);

		for (const variant of XML_ORDER_CORE_VARIANTS) {
			const output = (
				await layoutProcess(await reorderFlowElements(xml, variant))
			).xml;
			const metrics = await evaluateMetrics(output);
			const current = getRequired(metrics.current);

			assert.strictEqual(
				metrics.error,
				null,
				`${variant.name} should produce metrics`,
			);
			assert.strictEqual(
				hasBandADefect(metrics),
				false,
				`${variant.name} should not introduce a hard geometry defect`,
			);
			assert.ok(
				current.crossings <= 3,
				`${variant.name} should have at most three crossings`,
			);
			assert.ok(
				current.bendCount <= 22,
				`${variant.name} should have at most 22 bends`,
			);
		}
	});

});

function swapRetryAndSubprocess<Element extends BpmnElement>(
	elements: Element[],
): Element[] {
	const reordered = [...elements];
	const retryIndex = reordered.findIndex((element) => element.id === RETRY_ID);
	const subProcessIndex = reordered.findIndex((element) => {
		return element.id === SUBPROCESS_ID;
	});

	if (retryIndex === -1 || subProcessIndex === -1) {
		return reordered;
	}

	[reordered[retryIndex], reordered[subProcessIndex]] = [
		reordered[subProcessIndex],
		reordered[retryIndex],
	];

	return reordered;
}

async function readShapes(xml: string): Promise<Map<string, Bounds>> {
	const { rootElement } = await new BpmnModdle().fromXML(xml);
	const planeElements = rootElement.diagrams?.[0]?.plane?.planeElement || [];
	const shapes = new Map<string, Bounds>();

	for (const element of planeElements) {
		if (!isBpmndiType(element, "bpmndi:BPMNShape")) {
			continue;
		}

		const bounds = element.bounds;
		const id = element.bpmnElement?.id;

		if (!hasBounds(bounds) || typeof id !== "string") {
			continue;
		}

		shapes.set(id, bounds);
	}

	return shapes;
}

async function readEdges(xml: string): Promise<Map<string, Waypoint[]>> {
	const { rootElement } = await new BpmnModdle().fromXML(xml);
	const planeElements = rootElement.diagrams?.[0]?.plane?.planeElement || [];
	const edges = new Map<string, Waypoint[]>();

	for (const element of planeElements) {
		if (!isBpmndiType(element, "bpmndi:BPMNEdge")) {
			continue;
		}

		const id = element.bpmnElement?.id;

		if (!hasWaypoints(element.waypoint) || typeof id !== "string") {
			continue;
		}

		edges.set(id, element.waypoint);
	}

	return edges;
}

function hasBounds(value: unknown): value is Bounds {
	return (
		!!value &&
		typeof value === "object" &&
		"x" in value &&
		"y" in value &&
		"width" in value &&
		"height" in value &&
		typeof value.x === "number" &&
		typeof value.y === "number" &&
		typeof value.width === "number" &&
		typeof value.height === "number"
	);
}

function hasWaypoints(value: unknown): value is Waypoint[] {
	return (
		Array.isArray(value) &&
		value.every((point) => {
			return (
				!!point &&
				typeof point === "object" &&
				"x" in point &&
				"y" in point &&
				typeof point.x === "number" &&
				typeof point.y === "number"
			);
		})
	);
}

function getRequired<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined) {
		throw new Error("Expected XML-order invariant value.");
	}

	return value;
}
