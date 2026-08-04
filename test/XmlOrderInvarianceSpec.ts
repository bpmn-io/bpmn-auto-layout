import assert from "node:assert";
import { readFile } from "node:fs/promises";

import { BpmnModdle } from "bpmn-moddle";
import { describe, it } from "mocha";

import { layoutProcess } from "bpmn-auto-layout";

import { isBpmndiType } from "../lib/layout/bpmn/Types.js";
import { evaluateMetrics, hasBandADefect } from "./metrics/evaluateMetrics.js";
import {
	reorderFlowElements,
	XML_ORDER_VARIANTS,
} from "../tasks/xml-order-variants.js";

import type { BpmnElement } from "../lib/layout/bpmn/Types.js";

type Bounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const FIXTURE = "expanded-subprocess-retry-loop.bpmn";
const RETRY_ID = "Activity_1rcdusb";
const SUBPROCESS_ID = "Activity_0jyy09f";
const ENTRY_GATEWAY_ID = "Gateway_01mjb0r";
const EXIT_GATEWAY_ID = "Gateway_10bvoyq";
const variants = [
	...XML_ORDER_VARIANTS,
	{
		name: "subprocess-before-retry",
		reorder: swapRetryAndSubprocess,
	},
];

describe("XML order invariance", function () {
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
});

function swapRetryAndSubprocess(elements: BpmnElement[]): BpmnElement[] {
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

function getRequired<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined) {
		throw new Error("Expected XML-order invariant value.");
	}

	return value;
}
