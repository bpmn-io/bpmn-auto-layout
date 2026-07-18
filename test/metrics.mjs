import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { layoutProcess } from '../lib/index.js';

import { evaluateMetrics } from './metrics/evaluateMetrics.js';

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
      rows.push({
        fixture: fileName,
        crossings: 'ERROR',
        overlaps: err.message,
        edgeShapeIntersections: '',
        wrongWayDockings: '',
        edgeLength: ''
      });
      errors.push(`${fileName}: ${err.message}`);
    }
  }

  rows.push(formatTotalRow(results, baseline));

  printTable(rows);
  assertLayoutErrors(errors);
  assertNoWrongWayDockings(results);

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

  function assertNoWrongWayDockings(results) {
    const defects = Object.entries(results)
      .filter(([, metrics ]) => metrics.wrongWayDockings !== 0)
      .map(([ name, metrics ]) => `${name}: ${metrics.wrongWayDockings}`);

    if (defects.length) {
      throw new Error(`Wrong-way dockings found:\n${defects.join('\n')}`);
    }
  }
}

function formatRow(fixture, metrics, base) {
  const cell = key => base
    ? `${ metrics[key] } (${ delta(metrics[key] - (base[key] ?? 0)) })`
    : `${ metrics[key] }`;

  return {
    fixture,
    crossings: cell('crossings'),
    overlaps: cell('overlaps'),
    edgeShapeIntersections: cell('edgeShapeIntersections'),
    wrongWayDockings: cell('wrongWayDockings'),
    edgeLength: cell('edgeLength')
  };
}

function formatTotalRow(results, baseline) {
  const sum = key => Object.values(results).reduce((acc, m) => acc + m[key], 0);
  const baseSum = key => baseline
    ? Object.keys(results).reduce((acc, name) => acc + (baseline[name]?.[key] ?? 0), 0)
    : null;

  const cell = key => baseline
    ? `${ sum(key) } (${ delta(sum(key) - baseSum(key)) })`
    : `${ sum(key) }`;

  return {
    fixture: 'TOTAL',
    crossings: cell('crossings'),
    overlaps: cell('overlaps'),
    edgeShapeIntersections: cell('edgeShapeIntersections'),
    wrongWayDockings: cell('wrongWayDockings'),
    edgeLength: cell('edgeLength')
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
    'crossings',
    'overlaps',
    'edgeShapeIntersections',
    'wrongWayDockings',
    'edgeLength'
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
