import { readFile, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { layoutProcess } from '../dist/index.js';
import {
  calculateStatistics,
  parseIterationCount
} from './benchmark-util.mjs';

const WARMUP_ITERATIONS = 20;
const projectRoot = resolve(import.meta.dirname, '..');
const fixturesDirectory = resolve(projectRoot, 'test', 'fixtures');

export async function resolveFixturePath(fixtureArgument) {
  const fixtureName = fixtureArgument.endsWith('.bpmn')
    ? fixtureArgument
    : `${fixtureArgument}.bpmn`;
  const candidates = [
    resolve(fixturesDirectory, fixtureName),
    resolve(projectRoot, fixtureName)
  ];
  let fixtureRelativePath;

  for (const fixturePath of new Set(candidates)) {
    const candidateRelativePath = relative(fixturesDirectory, fixturePath);

    if (candidateRelativePath.startsWith(`..${sep}`) || candidateRelativePath === '..') {
      continue;
    }

    fixtureRelativePath = candidateRelativePath;

    try {
      await stat(fixturePath);

      return {
        fixturePath,
        fixtureRelativePath
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  if (fixtureRelativePath === undefined) {
    throw new Error('Fixture must be below test/fixtures.');
  }

  throw new Error(`Fixture not found: ${fixtureRelativePath}`);
}

async function benchmarkFixture(fixtureArgument, iterations) {
  const {
    fixturePath,
    fixtureRelativePath
  } = await resolveFixturePath(fixtureArgument);

  if (fixtureRelativePath.split(sep)[0] === 'failures') {
    throw new Error('Failure fixtures do not produce benchmarkable layout output.');
  }

  const fixtureXml = await readFile(fixturePath, 'utf8');

  for (let index = 0; index < WARMUP_ITERATIONS; index++) {
    await layoutProcess(fixtureXml);
  }

  const times = [];

  for (let index = 0; index < iterations; index++) {
    const started = performance.now();

    await layoutProcess(fixtureXml);
    times.push(performance.now() - started);
  }

  return {
    fixture: basename(fixtureRelativePath),
    iterations,
    statistics: calculateStatistics(times)
  };
}

function formatMilliseconds(value) {
  return `${value.toFixed(2)} ms`;
}

async function run() {
  const [ fixtureArgument, iterationArgument ] = process.argv.slice(2);

  if (!fixtureArgument || !iterationArgument) {
    throw new Error('Usage: npm run benchmark:fixture -- <fixture-name-or-path> <iterations>');
  }

  const benchmark = await benchmarkFixture(
    fixtureArgument,
    parseIterationCount(iterationArgument)
  );
  const { fixture, iterations, statistics } = benchmark;

  console.log(`Benchmark: ${fixture}`);
  console.log(`Iterations: ${iterations} (${WARMUP_ITERATIONS} warm-ups excluded)`);
  console.log(`Average: ${formatMilliseconds(statistics.averageMs)}`);
  console.log(`P50: ${formatMilliseconds(statistics.p50Ms)}`);
  console.log(`P90: ${formatMilliseconds(statistics.p90Ms)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
