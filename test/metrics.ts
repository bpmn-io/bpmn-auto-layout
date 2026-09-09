import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { layoutProcess } from '../lib/index.js';

import { computeMetrics } from './metrics/computeMetrics.js';

import type { LayoutMetrics } from './metrics/Types.js';

type MetricKey =
  | 'crossings'
  | 'parallelEdgeOverlaps'
  | 'bendCount'
  | 'overlaps'
  | 'edgeShapeIntersections'
  | 'detachedDockings'
  | 'wrongWayDockings'
  | 'nonOrthogonalConnections'
  | 'backtrackingConnections'
  | 'averageEdgeLength'
  | 'edgeSegmentLengthDeviation'
  | 'labelShapeOverlaps'
  | 'labelEdgeOverlaps'
  | 'compactness'
  | 'gridAlignment'
  | 'branchSymmetry';

type MetricValues = Pick<LayoutMetrics, MetricKey>;

type MetricsByFixture = {
  [fixtureName: string]: MetricValues;
};

type BaselineMetricValues = Partial<MetricValues>;

type BaselineByFixture = {
  [fixtureName: string]: BaselineMetricValues;
};

type TableRow = {
  fixture: string;
} & {
  [key in MetricKey]: string;
};

const METRIC_KEYS: readonly MetricKey[] = [
  'crossings',
  'parallelEdgeOverlaps',
  'bendCount',
  'overlaps',
  'edgeShapeIntersections',
  'detachedDockings',
  'wrongWayDockings',
  'nonOrthogonalConnections',
  'backtrackingConnections',
  'averageEdgeLength',
  'edgeSegmentLengthDeviation',
  'labelShapeOverlaps',
  'labelEdgeOverlaps',
  'compactness',
  'gridAlignment',
  'branchSymmetry'
];

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDirectory = path.join(__dirname, 'fixtures');
const baselineFile = path.join(__dirname, 'metrics', 'baseline.json');

const UPDATE_BASELINE = process.env.UPDATE_BASELINE === 'true';

if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export async function run(): Promise<void> {
  const baseline = !UPDATE_BASELINE && fs.existsSync(baselineFile)
    ? readBaseline(baselineFile)
    : null;

  const fixtures = fs.readdirSync(fixturesDirectory)
    .filter(name => name.endsWith('.bpmn'))
    .sort();

  const results: MetricsByFixture = {};
  const rows: TableRow[] = [];
  const errors: string[] = [];

  for (const fileName of fixtures) {
    const xml = fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');

    try {
      const { xml: output } = await layoutProcess(xml);
      const metrics = pickMetricValues(await computeMetrics(output));

      results[fileName] = metrics;
      rows.push(formatRow(fileName, metrics, baseline?.[fileName]));
    } catch (error) {
      const message = errorMessage(error);

      rows.push(createMetricRow(fileName, key => {
        if (key === 'crossings') {
          return 'ERROR';
        }

        return key === 'overlaps' ? message : '';
      }));
      errors.push(`${fileName}: ${message}`);
    }
  }

  rows.push(formatTotalRow(results, baseline));

  printTable(rows);
  assertLayoutErrors(errors);
  assertNoBandADefects(results);
  assertNoLabelDefects(results);

  if (UPDATE_BASELINE) {
    fs.writeFileSync(baselineFile, JSON.stringify(results, null, 2) + '\n', 'utf8');
    console.log(`\nWrote baseline for ${ Object.keys(results).length } fixtures to ${ path.relative(process.cwd(), baselineFile) }`);
  } else if (baseline) {
    console.log('\n(Δ shown vs recorded baseline. Run `npm run metrics:update` to re-record.)');
  } else {
    console.log('\nNo baseline recorded yet. Run `npm run metrics:update` to record one.');
  }

  function assertLayoutErrors(errors: readonly string[]): void {
    if (errors.length) {
      throw new Error(`Layout failed for fixture(s):\n${errors.join('\n')}`);
    }
  }

  function assertNoBandADefects(results: MetricsByFixture): void {
    const defects = Object.entries(results)
      .filter(([, metrics ]) => hasBandADefect(metrics))
      .map(([ name, metrics ]) => {
        return `${name}: overlaps=${metrics.overlaps}, ` +
          `edgeShapeIntersections=${metrics.edgeShapeIntersections}, ` +
          `detachedDockings=${metrics.detachedDockings}, ` +
          `wrongWayDockings=${metrics.wrongWayDockings}, ` +
          `nonOrthogonalConnections=${metrics.nonOrthogonalConnections}, ` +
          `backtrackingConnections=${metrics.backtrackingConnections}`;
      });

    if (defects.length) {
      throw new Error(`Band-A geometry defects found:\n${defects.join('\n')}`);
    }
  }

  function assertNoLabelDefects(results: MetricsByFixture): void {
    const defects = Object.entries(results)
      .filter(([, metrics ]) => {
        return metrics.labelShapeOverlaps || metrics.labelEdgeOverlaps;
      })
      .map(([ name, metrics ]) => {
        return `${name}: labelShapeOverlaps=${metrics.labelShapeOverlaps}, ` +
          `labelEdgeOverlaps=${metrics.labelEdgeOverlaps}`;
      });

    if (defects.length) {
      throw new Error(`Label overlaps found:\n${defects.join('\n')}`);
    }
  }
}

function formatRow(
    fixture: string,
    metrics: MetricValues,
    base: BaselineMetricValues | undefined
): TableRow {
  return createMetricRow(fixture, key => base
    ? `${ metrics[key] } (${ delta(metrics[key] - (base[key] ?? 0)) })`
    : `${ metrics[key] }`
  );
}

function formatTotalRow(
    results: MetricsByFixture,
    baseline: BaselineByFixture | null
): TableRow {
  const averageKeys = new Set<MetricKey>([
    'averageEdgeLength',
    'edgeSegmentLengthDeviation',
    'compactness',
    'gridAlignment',
    'branchSymmetry'
  ]);
  const aggregate = (
      metrics: MetricsByFixture | BaselineByFixture,
      key: MetricKey
  ): number => {
    const values = Object.values(metrics)
      .map(item => item[key])
      .filter((value): value is number => typeof value === 'number');

    if (!values.length) {
      return 0;
    }

    const total = values.reduce((acc, value) => acc + value, 0);

    return averageKeys.has(key)
      ? Math.round(total / values.length * 10) / 10
      : total;
  };
  const baselineMetrics = baseline ? selectFixtures(results, baseline) : {};

  return createMetricRow('TOTAL', key => {
    const total = aggregate(results, key);

    return baseline
      ? `${ total } (${ delta(total - aggregate(baselineMetrics, key)) })`
      : `${ total }`;
  });
}

function delta(n: number): string {
  if (n === 0) {
    return '±0';
  }

  return n > 0 ? `+${ n }` : `${ n }`;
}

function printTable(rows: readonly TableRow[]): void {
  const columns: readonly (MetricKey | 'fixture')[] = [
    'fixture',
    ...METRIC_KEYS
  ];
  const widths = new Map<string, number>(
    columns.map(column => [
      column,
      Math.max(column.length, ...rows.map(row => row[column].length))
    ])
  );

  const line = (row: TableRow): string => columns
    .map(column => row[column].padEnd(widths.get(column) || 0))
    .join('  ');

  const header = createMetricRow('fixture', key => key);

  console.log('');
  console.log(line(header));
  console.log(columns.map(column => '-'.repeat(widths.get(column) || 0)).join('  '));
  rows.forEach(row => console.log(line(row)));
}

function pickMetricValues(metrics: LayoutMetrics): MetricValues {
  return {
    crossings: metrics.crossings,
    parallelEdgeOverlaps: metrics.parallelEdgeOverlaps,
    bendCount: metrics.bendCount,
    overlaps: metrics.overlaps,
    edgeShapeIntersections: metrics.edgeShapeIntersections,
    detachedDockings: metrics.detachedDockings,
    wrongWayDockings: metrics.wrongWayDockings,
    nonOrthogonalConnections: metrics.nonOrthogonalConnections,
    backtrackingConnections: metrics.backtrackingConnections,
    averageEdgeLength: metrics.averageEdgeLength,
    edgeSegmentLengthDeviation: metrics.edgeSegmentLengthDeviation,
    labelShapeOverlaps: metrics.labelShapeOverlaps,
    labelEdgeOverlaps: metrics.labelEdgeOverlaps,
    compactness: metrics.compactness,
    gridAlignment: metrics.gridAlignment,
    branchSymmetry: metrics.branchSymmetry
  };
}

function createMetricRow(
    fixture: string,
    value: (key: MetricKey) => string
): TableRow {
  return {
    fixture,
    crossings: value('crossings'),
    parallelEdgeOverlaps: value('parallelEdgeOverlaps'),
    bendCount: value('bendCount'),
    overlaps: value('overlaps'),
    edgeShapeIntersections: value('edgeShapeIntersections'),
    detachedDockings: value('detachedDockings'),
    wrongWayDockings: value('wrongWayDockings'),
    nonOrthogonalConnections: value('nonOrthogonalConnections'),
    backtrackingConnections: value('backtrackingConnections'),
    averageEdgeLength: value('averageEdgeLength'),
    edgeSegmentLengthDeviation: value('edgeSegmentLengthDeviation'),
    labelShapeOverlaps: value('labelShapeOverlaps'),
    labelEdgeOverlaps: value('labelEdgeOverlaps'),
    compactness: value('compactness'),
    gridAlignment: value('gridAlignment'),
    branchSymmetry: value('branchSymmetry')
  };
}

function hasBandADefect(metrics: MetricValues): boolean {
  return metrics.overlaps !== 0 ||
    metrics.edgeShapeIntersections !== 0 ||
    metrics.detachedDockings !== 0 ||
    metrics.wrongWayDockings !== 0 ||
    metrics.nonOrthogonalConnections !== 0 ||
    metrics.backtrackingConnections !== 0;
}

function selectFixtures(
    results: MetricsByFixture,
    baseline: BaselineByFixture
): BaselineByFixture {
  const selected: BaselineByFixture = {};

  for (const fixtureName of Object.keys(results)) {
    const metrics = baseline[fixtureName];

    if (metrics) {
      selected[fixtureName] = metrics;
    }
  }

  return selected;
}

function readBaseline(file: string): BaselineByFixture {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (!isBaselineByFixture(parsed)) {
    throw new Error(`Invalid metrics baseline: ${file}`);
  }

  return parsed;
}

function isBaselineByFixture(value: unknown): value is BaselineByFixture {
  return isObject(value) && Object.values(value).every(isBaselineMetricValues);
}

function isBaselineMetricValues(value: unknown): value is BaselineMetricValues {
  return isObject(value) && Object.entries(value).every(([ key, metric ]) => {
    return isMetricKey(key) && typeof metric === 'number';
  });
}

function isMetricKey(value: string): value is MetricKey {
  return METRIC_KEYS.some(key => key === value);
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
