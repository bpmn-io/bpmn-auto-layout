import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BpmnModdle } from "bpmn-moddle";
import { convertAll } from "bpmn-to-image";

import { layoutProcess } from "../dist/index.js";
import { isBpmndiType } from "../lib/layout/bpmn/Types.js";
import {
	METRIC_KEYS,
	evaluateMetrics,
} from "../test/metrics/evaluateMetrics.js";
import { resolveFixturePath } from "./benchmark-fixture.js";
import {
	reorderFlowElements,
	XML_ORDER_VARIANTS,
} from "./xml-order-variants.js";

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
type DiSnapshot = {
	edges: Map<string, Waypoint[]>;
	shapes: Map<string, Bounds>;
};
type MetricValues = NonNullable<
	Awaited<ReturnType<typeof evaluateMetrics>>["current"]
>;
type DiDifference = {
	changedEdges: string[];
	movedShapes: string[];
	resizedShapes: string[];
};
type VariantReport = {
	difference: DiDifference | null;
	layoutPath: string;
	metrics: MetricValues | null;
	metricsError: string | null;
	name: string;
	sourcePath: string;
	svgPath: string;
	warnings: Array<{
		code: string;
		elementId: string | undefined;
		message: string;
	}>;
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "test", "output", "xml-order");
const [fixtureArgument] = process.argv.slice(2);

if (!fixtureArgument) {
	throw new Error("Usage: npm run inspect:xml-order -- <fixture-name-or-path>");
}

const { fixturePath, fixtureRelativePath } =
	await resolveFixturePath(fixtureArgument);

if (fixtureRelativePath.split(/[/\\]/)[0] === "failures") {
	throw new Error("Failure fixtures do not produce XML-order layout reports.");
}

const fixtureName = basename(fixtureRelativePath, ".bpmn");
const outputDirectory = resolve(outputRoot, fixtureName);
const fixtureXml = await readFile(fixturePath, "utf8");

await mkdir(outputDirectory, { recursive: true });

const reports: VariantReport[] = [];
let authoredSnapshot: DiSnapshot | null = null;
let authoredMetrics: MetricValues | null = null;

for (const variant of XML_ORDER_VARIANTS) {
	const sourceXml = await reorderFlowElements(fixtureXml, variant);
	const result = await layoutProcess(sourceXml);
	const metrics = await evaluateMetrics(result.xml);
	const sourcePath = resolve(outputDirectory, `${variant.name}.source.bpmn`);
	const layoutPath = resolve(outputDirectory, `${variant.name}.layout.bpmn`);
	const svgPath = resolve(outputDirectory, `${variant.name}.layout.svg`);
	const snapshot = await readDiSnapshot(result.xml);
	const currentMetrics = metrics.current;

	await Promise.all([
		writeFile(sourcePath, sourceXml, "utf8"),
		writeFile(layoutPath, result.xml, "utf8"),
	]);

	reports.push({
		difference: authoredSnapshot ? diffDi(authoredSnapshot, snapshot) : null,
		layoutPath: relative(outputDirectory, layoutPath),
		metrics: currentMetrics,
		metricsError: metrics.error,
		name: variant.name,
		sourcePath: relative(outputDirectory, sourcePath),
		svgPath: relative(outputDirectory, svgPath),
		warnings: result.warnings.map((warning) => ({
			code: warning.code,
			elementId: warning.elementId,
			message: warning.message,
		})),
	});

	authoredSnapshot ||= snapshot;
	authoredMetrics ||= currentMetrics;
}

await convertAll(
	reports.map((report) => ({
		input: resolve(outputDirectory, report.layoutPath),
		outputs: [resolve(outputDirectory, report.svgPath)],
	})),
	{
		footer: false,
		title: false,
	},
);

const manifest = {
	fixture: fixtureRelativePath,
	reports: reports.map((report) => ({
		...report,
		metricDelta: metricDelta(report.metrics, authoredMetrics),
	})),
};
const manifestPath = resolve(outputDirectory, "manifest.json");
const indexPath = resolve(outputDirectory, "index.html");

await Promise.all([
	writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8"),
	writeFile(indexPath, createReportHtml(manifest), "utf8"),
]);

console.log(`XML-order report: ${fixtureRelativePath}`);
console.log(`  ${relative(projectRoot, indexPath)}`);

function metricDelta(
	metrics: MetricValues | null,
	authored: MetricValues | null,
): Record<string, number> | null {
	if (!metrics || !authored) {
		return null;
	}

	return Object.fromEntries(
		METRIC_KEYS.map((key) => {
			return [key, metrics[key] - authored[key]];
		}),
	);
}

async function readDiSnapshot(xml: string): Promise<DiSnapshot> {
	const { rootElement } = await new BpmnModdle().fromXML(xml);
	const edges = new Map<string, Waypoint[]>();
	const shapes = new Map<string, Bounds>();

	for (const diagram of rootElement.diagrams || []) {
		for (const element of diagram.plane?.planeElement || []) {
			if (
				isBpmndiType(element, "bpmndi:BPMNShape") &&
				hasBounds(element.bounds)
			) {
				const id = element.bpmnElement?.id;

				if (typeof id === "string") {
					shapes.set(id, element.bounds);
				}
			} else if (
				isBpmndiType(element, "bpmndi:BPMNEdge") &&
				hasWaypoints(element.waypoint)
			) {
				const id = element.bpmnElement?.id;

				if (typeof id === "string") {
					edges.set(id, element.waypoint);
				}
			}
		}
	}

	return { edges, shapes };
}

function diffDi(authored: DiSnapshot, variant: DiSnapshot): DiDifference {
	const changedEdges: string[] = [];
	const movedShapes: string[] = [];
	const resizedShapes: string[] = [];

	for (const [id, authoredBounds] of authored.shapes) {
		const variantBounds = variant.shapes.get(id);

		if (!variantBounds) {
			movedShapes.push(`${id} (missing)`);
			continue;
		}

		if (
			authoredBounds.x !== variantBounds.x ||
			authoredBounds.y !== variantBounds.y
		) {
			movedShapes.push(
				`${id} (${formatShapeMovement(authoredBounds, variantBounds)})`,
			);
		}
		if (
			authoredBounds.width !== variantBounds.width ||
			authoredBounds.height !== variantBounds.height
		) {
			resizedShapes.push(
				`${id} (${formatShapeResize(authoredBounds, variantBounds)})`,
			);
		}
	}

	for (const [id, authoredWaypoints] of authored.edges) {
		const variantWaypoints = variant.edges.get(id);

		if (
			!variantWaypoints ||
			!equalWaypoints(authoredWaypoints, variantWaypoints)
		) {
			changedEdges.push(id);
		}
	}

	return { changedEdges, movedShapes, resizedShapes };
}

function formatShapeMovement(authored: Bounds, variant: Bounds): string {
	return `dx=${variant.x - authored.x}, dy=${variant.y - authored.y}`;
}

function formatShapeResize(authored: Bounds, variant: Bounds): string {
	return `dw=${variant.width - authored.width}, dh=${variant.height - authored.height}`;
}

function equalWaypoints(first: Waypoint[], second: Waypoint[]): boolean {
	return (
		first.length === second.length &&
		first.every((point, index) => {
			const other = second[index];

			return point.x === other.x && point.y === other.y;
		})
	);
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

function createReportHtml(manifest: {
	fixture: string;
	reports: Array<
		VariantReport & {
			metricDelta: Record<string, number> | null;
		}
	>;
}): string {
	const payload = Buffer.from(JSON.stringify(manifest)).toString("base64");

	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>XML-order review</title>
    <style>
      :root {
        --issue-stroke: #c2410c;
        --issue-background: #fff7ed;
      }

      body {
        margin: 0;
        font-family: monospace;
        font-weight: bold;
        font-size: 12px;
      }

      #scroll-container {
        height: 100vh;
        overflow-y: auto;
      }

      .statistic {
        position: sticky;
        top: 0;
        z-index: 1;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        min-height: 40px;
        padding: 8px 16px;
        border-bottom: 1px solid #e5e5e5;
        background: #fff;
        font-size: large;
      }

      .inspector-title {
        flex-basis: 100%;
        margin: 0;
        color: #171717;
        font-size: 16px;
        line-height: 24px;
      }

      .fixture-name {
        min-width: 0;
      }

      .inspect-content {
        padding: 0 16px 20px;
      }

      .variants {
        display: block;
      }

      .variant {
        min-width: 0;
        margin-top: 10px;
      }

      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
        margin-bottom: 10px;
        padding: 8px 10px;
        border: 1px solid #e5e5e5;
        border-radius: 8px;
        background: #fafafa;
      }

      .fixture-path {
        color: #555;
        font-size: 12px;
      }

      .links {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-left: auto;
        font-weight: normal;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        height: 28px;
        padding: 0 10px;
        border: 1px solid #e5e5e5;
        border-radius: 8px;
        background: #fff;
        color: #171717;
        text-decoration: none;
      }

      .container {
        height: 500px;
        overflow: hidden;
        border: 1px solid #ccc;
        border-radius: 8px;
        background: #fff;
      }

      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .metrics-panel {
        flex-basis: 100%;
        box-sizing: border-box;
        border: 1px solid #e5e5e5;
        border-radius: 6px;
        background: #fff;
        color: #444;
        font-weight: normal;
      }

      details {
        box-sizing: border-box;
        margin-top: 10px;
        border: 1px solid #e5e5e5;
        border-radius: 6px;
        background: #fff;
        color: #444;
        font-weight: normal;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 6px;
        padding: 8px;
      }

      .metric {
        min-width: 0;
        padding: 6px 8px;
        border: 1px solid #e5e5e5;
        border-radius: 6px;
        background: #fafafa;
        color: #555;
      }

      .metric-good {
        border-color: #bbf7d0;
        background: #f0fdf4;
        color: #166534;
      }

      .metric-defect {
        border-color: #fecaca;
        background: #fef2f2;
        color: #dc2626;
      }

      .metric-name,
      .metric-delta {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #555;
      }

      .metric-name,
      .metric-delta {
        font-size: 11px;
      }

      .metric-value {
        display: block;
        margin: 2px 0;
        color: #171717;
        font-size: 14px;
        font-weight: bold;
      }

      .metric-good .metric-value,
      .metric-defect .metric-value {
        color: inherit;
      }

      .warning {
        margin: 0;
        padding: 8px;
        border-top: 1px solid #fed7aa;
        background: var(--issue-background);
        color: #9a3412;
      }

      details {
        padding: 8px;
      }

      summary {
        cursor: pointer;
        font-weight: bold;
      }

      ul {
        margin: 8px 0 0;
        padding-left: 18px;
      }
    </style>
  </head>
  <body>
    <div id="scroll-container">
      <header class="statistic"><h1 class="inspector-title">Layout variation inspector</h1><span id="fixture" class="fixture-path"></span></header>
      <main class="inspect-content"><div class="variants" id="variants"></div></main>
    </div>
    <script>
      const manifest = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${payload}'), c => c.charCodeAt(0))));
      const fixture = document.getElementById('fixture');
      const variants = document.getElementById('variants');
      const defectMetricKeys = new Set([
        'crossings',
        'overlaps',
        'edgeShapeIntersections',
        'detachedDockings',
        'wrongWayDockings',
        'nonOrthogonalConnections',
        'backtrackingConnections',
      ]);
      fixture.textContent = manifest.fixture;
      for (const report of manifest.reports) {
        const card = document.createElement('section');
        card.className = 'variant';
        const differences = report.difference || { movedShapes: [], resizedShapes: [], changedEdges: [] };
        const metrics = Object.entries(report.metrics || {});
        const metricClass = ([key, value]) => defectMetricKeys.has(key) ? value === 0 ? 'metric-good' : 'metric-defect' : '';
        const metricDelta = ([key]) => {
          const delta = report.metricDelta && report.metricDelta[key];
          return delta === 0 || delta === undefined ? 'No change' : \`\${ delta > 0 ? '+' : '' }\${ delta }\`;
        };
        card.innerHTML = \`
          <div class="title">
            <span class="fixture-name">\${ report.name }</span>
            <div class="links"><a class="button" href="\${ report.sourcePath }">Source</a><a class="button" href="\${ report.layoutPath }">BPMN</a><a class="button" href="\${ report.svgPath }">SVG</a></div>
            <div class="metrics-panel">
              <div class="metrics-grid">\${ metrics.map(metric => \`<div class="metric \${ metricClass(metric) }"><span class="metric-name">\${ metric[0] }</span><span class="metric-value">\${ metric[1] }</span><span class="metric-delta">\${ metricDelta(metric) }</span></div>\`).join('') }</div>
              \${ report.metricsError ? \`<p class="warning">\${ report.metricsError }</p>\` : '' }
              \${ report.warnings.length ? \`<p class="warning">Warnings: \${ report.warnings.map(warning => warning.code + (warning.elementId ? ' (' + warning.elementId + ')' : '')).join(', ') }</p>\` : '' }
            </div>
          </div>
          <div class="container"><img src="\${ report.svgPath }" alt="\${ report.name } layout"></div>
          <details><summary>DI differences: \${ differences.movedShapes.length } moved shapes, \${ differences.resizedShapes.length } resized shapes, \${ differences.changedEdges.length } changed edges</summary>
            <ul><li>Moved: \${ differences.movedShapes.join(', ') || 'none' }</li><li>Resized: \${ differences.resizedShapes.join(', ') || 'none' }</li><li>Edges: \${ differences.changedEdges.join(', ') || 'none' }</li></ul>
          </details>\`;
        variants.append(card);
      }
    </script>
  </body>
</html>`;
}
