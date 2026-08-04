import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { layoutProcess } from "../dist/index.js";
import {
	METRIC_KEYS,
	evaluateMetrics,
	hasBandADefect,
} from "../test/metrics/evaluateMetrics.js";
import { resolveFixturePath } from "./benchmark-fixture.js";
import {
	reorderFlowElements,
	XML_ORDER_VARIANTS,
} from "./xml-order-variants.js";

const [fixtureArgument] = process.argv.slice(2);

if (!fixtureArgument) {
	throw new Error("Usage: npm run test:xml-order -- <fixture-name-or-path>");
}

const { fixturePath, fixtureRelativePath } =
	await resolveFixturePath(fixtureArgument);

if (fixtureRelativePath.split(/[/\\]/)[0] === "failures") {
	throw new Error("Failure fixtures do not produce XML-order layout output.");
}

const fixtureXml = await readFile(fixturePath, "utf8");
const reports = [];

for (const variant of XML_ORDER_VARIANTS) {
	const xml = await reorderFlowElements(fixtureXml, variant);
	const result = await layoutProcess(xml);
	const metrics = await evaluateMetrics(result.xml);

	if (metrics.error || !metrics.current) {
		throw new Error(
			`${variant.name} did not produce layout metrics: ${metrics.error}`,
		);
	}
	if (result.warnings.some((warning) => warning.code === "DI_NOT_CREATED")) {
		throw new Error(`${variant.name} omitted expected DI.`);
	}
	if (hasBandADefect(metrics)) {
		throw new Error(`${variant.name} introduced a Band-A geometry defect.`);
	}

	reports.push({
		variant: variant.name,
		metrics: metrics.current,
	});
}

console.log(`XML-order check: ${basename(fixtureRelativePath)}`);

const authoredMetrics = reports[0].metrics;

for (const { variant, metrics } of reports) {
	console.log(`  ${variant}`);
	console.log(`    ${formatMetrics(metrics)}`);
	console.log(`    delta: ${formatDelta(metrics, authoredMetrics)}`);
}

function formatMetrics(
	metrics: NonNullable<Awaited<ReturnType<typeof evaluateMetrics>>["current"]>,
): string {
	return METRIC_KEYS.map((key) => `${key}=${metrics[key]}`).join(", ");
}

function formatDelta(
	metrics: NonNullable<Awaited<ReturnType<typeof evaluateMetrics>>["current"]>,
	authoredMetrics: NonNullable<
		Awaited<ReturnType<typeof evaluateMetrics>>["current"]
	>,
): string {
	const changes = METRIC_KEYS.map(
		(key) => [key, metrics[key] - authoredMetrics[key]] as const,
	)
		.filter(([, delta]) => delta !== 0)
		.map(([key, delta]) => `${key}=${delta > 0 ? "+" : ""}${delta}`);

	return changes.join(", ") || "no metric changes";
}
