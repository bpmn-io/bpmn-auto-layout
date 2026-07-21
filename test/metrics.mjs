import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { layoutProcess } from '../lib/index.js';

import { evaluateMetrics, hasBandADefect, METRIC_KEYS } from './metrics/evaluateMetrics.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDirectory = path.join(__dirname, 'fixtures');
const baselineFile = path.join(__dirname, 'metrics', 'baseline.json');

const UPDATE_BASELINE = process.env.UPDATE_BASELINE === 'true';

if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  run().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}

export async function run() {
  const baseline = !UPDATE_BASELINE && fs.existsSync(baselineFile)
    ? JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
    : null;

  const fixtures = fs.readdirSync(fixturesDirectory)
    .filter(name => name.endsWith('.bpmn'))
    .sort();

  const results = {};
  const rows = [];
  const errors = [];

  for (const fileName of fixtures) {
    const xml = fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');

    try {
      const output = await layoutProcess(xml);
      const metrics = await evaluateMetrics(output, baseline?.[fileName]);

      if (metrics.error) {
        throw new Error(metrics.error);
      }

      results[fileName] = metrics.current;
      rows.push(formatRow(fileName, metrics.current, metrics.baseline));
    } catch (err) {
      const row = Object.fromEntries(METRIC_KEYS.map(key => [ key, '' ]));
      row.fixture = fileName;
      row.crossings = 'ERROR';
      row.overlaps = err.message;
      rows.push(row);
      errors.push(`${fileName}: ${err.message}`);
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

  function assertLayoutErrors(errors) {
    if (errors.length) {
      throw new Error(`Layout failed for fixture(s):\n${errors.join('\n')}`);
    }
  }

  function assertNoBandADefects(results) {
    const defects = Object.entries(results)
      .filter(([, metrics ]) => hasBandADefect({ current: metrics, error: null }))
      .map(([ name, metrics ]) => {
        return `${name}: overlaps=${metrics.overlaps}, ` +
          `edgeShapeIntersections=${metrics.edgeShapeIntersections}, ` +
          `wrongWayDockings=${metrics.wrongWayDockings}`;
      });

    if (defects.length) {
      throw new Error(`Band-A geometry defects found:\n${defects.join('\n')}`);
    }
  }

  function assertNoLabelDefects(results) {
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

function formatRow(fixture, metrics, base) {
  const cell = key => base
    ? `${ metrics[key] } (${ delta(metrics[key] - (base[key] ?? 0)) })`
    : `${ metrics[key] }`;

  return {
    fixture,
    ...Object.fromEntries(METRIC_KEYS.map(key => [ key, cell(key) ]))
  };
}

function formatTotalRow(results, baseline) {
  const averageKeys = new Set([
    'averageEdgeLength',
    'edgeSegmentLengthDeviation',
    'compactness',
    'gridAlignment',
    'branchSymmetry'
  ]);
  const aggregate = (metrics, key) => {
    const values = Object.values(metrics)
      .map(item => item[key])
      .filter(value => typeof value === 'number');

    if (!values.length) {
      return 0;
    }

    const total = values.reduce((acc, value) => acc + value, 0);

    return averageKeys.has(key)
      ? Math.round(total / values.length * 10) / 10
      : total;
  };
  const baselineMetrics = baseline
    ? Object.fromEntries(Object.keys(results).map(name => [ name, baseline[name] || {} ]))
    : null;

  const cell = key => baseline
    ? `${ aggregate(results, key) } (${ delta(aggregate(results, key) - aggregate(baselineMetrics, key)) })`
    : `${ aggregate(results, key) }`;

  return {
    fixture: 'TOTAL',
    ...Object.fromEntries(METRIC_KEYS.map(key => [ key, cell(key) ]))
  };
}

function delta(n) {
  if (n === 0) {
    return '±0';
  }

  return n > 0 ? `+${ n }` : `${ n }`;
}

function printTable(rows) {
  const columns = [
    'fixture',
    ...METRIC_KEYS
  ];
  const widths = columns.reduce((acc, col) => {
    acc[col] = Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length));
    return acc;
  }, {});

  const line = row => columns
    .map(col => String(row[col] ?? '').padEnd(widths[col]))
    .join('  ');

  const header = {};
  columns.forEach(col => header[col] = col);

  console.log('');
  console.log(line(header));
  console.log(columns.map(col => '-'.repeat(widths[col])).join('  '));
  rows.forEach(row => console.log(line(row)));
}
