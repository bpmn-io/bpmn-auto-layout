import { BpmnModdle } from "bpmn-moddle";

import { isBpmnType } from "../lib/layout/bpmn/Types.js";

import type { BpmnElement, BpmnElementFor } from "../lib/layout/bpmn/Types.js";

type FlowElementsScope =
	| BpmnElementFor<"bpmn:Process">
	| BpmnElementFor<"bpmn:SubProcess">;

export type XmlOrderVariant = {
	name: string;
	reorder: (elements: BpmnElement[]) => BpmnElement[];
};

export const XML_ORDER_VARIANTS: readonly XmlOrderVariant[] = [
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

export async function reorderFlowElements(
	xml: string,
	variant: XmlOrderVariant,
): Promise<string> {
	const moddle = new BpmnModdle();
	const { rootElement } = await moddle.fromXML(xml);

	for (const root of rootElement.rootElements || []) {
		if (isFlowElementsScope(root)) {
			reorderScope(root, variant);
		}
	}

	return (await moddle.toXML(rootElement, { format: true })).xml;
}

function reorderScope(
	scope: FlowElementsScope,
	variant: XmlOrderVariant,
): void {
	const elements = scope.flowElements || [];

	scope.flowElements = variant.reorder(elements);

	for (const element of elements) {
		if (isBpmnType(element, "bpmn:SubProcess")) {
			reorderScope(element, variant);
		}
	}
}

function isFlowElementsScope(
	element: BpmnElement,
): element is FlowElementsScope {
	return (
		isBpmnType(element, "bpmn:Process") ||
		isBpmnType(element, "bpmn:SubProcess")
	);
}
