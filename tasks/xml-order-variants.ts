import { BpmnModdle } from "bpmn-moddle";

import { isBpmnType } from "../lib/layout/bpmn/Types.js";

import type { BpmnElement, BpmnElementFor } from "../lib/layout/bpmn/Types.js";
import type { BpmnLaneSet } from "../lib/moddle-types/bpmn.js";
import type { ModdleElement } from "moddle";

type FlowElementsScope =
	| BpmnElementFor<"bpmn:Process">
	| BpmnElementFor<"bpmn:SubProcess">;

export type XmlOrderVariant = {
	name: string;
	reorder: <Element extends BpmnElement>(elements: Element[]) => Element[];
};

export const XML_ORDER_CORE_VARIANTS: readonly XmlOrderVariant[] = [
	{
		name: "authored",
		reorder: (elements) => elements,
	},
	{
		name: "id-ascending",
		reorder: (elements) =>
			[...elements].sort((a, b) => {
				return (a.id || "").localeCompare(b.id || "");
			}),
	},
	{
		name: "reversed",
		reorder: (elements) => [...elements].reverse(),
	},
];

export const XML_ORDER_VARIANTS: readonly XmlOrderVariant[] = [
	...XML_ORDER_CORE_VARIANTS,
	...[
		0x1357_9bdf,
		0x2468_ace0,
		0x5eed_1234,
	].map((seed): XmlOrderVariant => ({
		name: `seed-${seed.toString(16)}`,
		reorder: (elements) =>
			[...elements].sort((a, b) => {
				return (
					stableOrderKey(a, seed) - stableOrderKey(b, seed) ||
					elementKey(a).localeCompare(elementKey(b))
				);
			}),
	})),
];

export async function reorderFlowElements(
	xml: string,
	variant: XmlOrderVariant,
): Promise<string> {
	if (variant.name === "authored") {
		return xml;
	}

	const moddle = new BpmnModdle();
	const { rootElement } = await moddle.fromXML(xml);
	const definitions = rootElement as BpmnElementFor<"bpmn:Definitions">;

	definitions.rootElements = variant.reorder(definitions.rootElements || []);

	for (const root of definitions.rootElements) {
		if (isFlowElementsScope(root)) {
			reorderScope(root, variant);
		} else if (isBpmnType(root, "bpmn:Collaboration")) {
			root.participants = variant.reorder(root.participants || []);
			root.messageFlows = variant.reorder(root.messageFlows || []);
			root.artifacts = variant.reorder(root.artifacts || []);
		}
	}

	return (await moddle.toXML(definitions, { format: true })).xml;
}

function reorderScope(
	scope: FlowElementsScope,
	variant: XmlOrderVariant,
): void {
	const elements = scope.flowElements || [];

	scope.flowElements = variant.reorder(elements);
	scope.artifacts = variant.reorder(scope.artifacts || []);
	reorderLaneMembership(scope, variant);

	for (const element of elements) {
		if (isBpmnType(element, "bpmn:FlowNode")) {
			element.incoming = variant.reorder(element.incoming || []);
			element.outgoing = variant.reorder(element.outgoing || []);
		}
		if (isBpmnType(element, "bpmn:Activity")) {
			element.dataInputAssociations = variant.reorder(
				element.dataInputAssociations || [],
			);
			element.dataOutputAssociations = variant.reorder(
				element.dataOutputAssociations || [],
			);
		}
		if (isBpmnType(element, "bpmn:SubProcess")) {
			reorderScope(element, variant);
		}
	}
}

function reorderLaneMembership(
	scope: FlowElementsScope,
	variant: XmlOrderVariant,
): void {
	if (!isBpmnType(scope, "bpmn:Process")) {
		return;
	}

	for (const laneSet of scope.laneSets || []) {
		reorderLaneSetMembership(laneSet, variant);
	}
}

function reorderLaneSetMembership(
	laneSet: ModdleElement<BpmnLaneSet>,
	variant: XmlOrderVariant,
): void {
	for (const lane of laneSet.lanes || []) {
		lane.flowNodeRef = variant.reorder(lane.flowNodeRef || []);

		if (lane.childLaneSet) {
			reorderLaneSetMembership(lane.childLaneSet, variant);
		}
	}
}

function stableOrderKey(element: BpmnElement, seed: number): number {
	let hash = seed >>> 0;

	for (const character of elementKey(element)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 0x0100_0193) >>> 0;
	}

	return hash;
}

function elementKey(element: BpmnElement): string {
	return `${element.id || ""}:${element.$type}`;
}

function isFlowElementsScope(
	element: BpmnElement,
): element is FlowElementsScope {
	return (
		isBpmnType(element, "bpmn:Process") ||
		isBpmnType(element, "bpmn:SubProcess")
	);
}
