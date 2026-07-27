import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { layoutProcess } from '../dist/index.js';
import {
  orderParticipantsByMessageFlow
} from '../lib/layout/CollaborationLayouter.js';
import { calculateStatistics } from './benchmark-util.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budgets = [
  {
    name: 'eight-participant exact ordering',
    operation: createParticipantOrderingOperation(8),
    warmups: 3,
    iterations: 7,
    maxP50Ms: 150
  },
  {
    name: 'application-processing fixture',
    operation: await createFixtureOperation('process.application-processing.bpmn'),
    warmups: 5,
    iterations: 5,
    maxP50Ms: 2000
  }
];

for (const budget of budgets) {
  await checkBudget(budget);
}

async function checkBudget({
  name,
  operation,
  warmups,
  iterations,
  maxP50Ms
}) {
  for (let index = 0; index < warmups; index++) {
    await operation();
  }

  const durations = [];

  for (let index = 0; index < iterations; index++) {
    const startedAt = performance.now();

    await operation();
    durations.push(performance.now() - startedAt);
  }

  const { p50Ms, p90Ms } = calculateStatistics(durations);

  console.log(
    `${ name }: p50=${ p50Ms.toFixed(2) } ms, ` +
    `p90=${ p90Ms.toFixed(2) } ms, budget=${ maxP50Ms } ms`
  );
  assert.ok(
    p50Ms <= maxP50Ms,
    `${ name } exceeded its ${ maxP50Ms } ms p50 budget ` +
    `with ${ p50Ms.toFixed(2) } ms.`
  );
}

async function createFixtureOperation(fileName) {
  const xml = await readFile(
    resolve(projectRoot, 'test', 'fixtures', fileName),
    'utf8'
  );

  return () => layoutProcess(xml);
}

function createParticipantOrderingOperation(participantCount) {
  const processes = Array.from({ length: participantCount }, (_, index) => ({
    id: `Process_${ index }`,
    $instanceOf() {
      return false;
    }
  }));
  const participants = processes.map((processRef, index) => ({
    id: `Participant_${ index }`,
    processRef,
    $instanceOf(type) {
      return type === 'bpmn:Participant';
    }
  }));
  const endpoints = processes.map((process, index) => ({
    id: `Endpoint_${ index }`,
    $parent: process,
    $instanceOf() {
      return false;
    }
  }));
  const messageFlows = endpoints.slice(1).map((targetRef, index) => ({
    id: `MessageFlow_${ index }`,
    sourceRef: endpoints[index],
    targetRef
  }));
  const collaboration = { participants, messageFlows };
  const participantShapes = new Map(
    participants.map((participant, index) => [
      participant,
      { x: 0, y: index * 180, width: 500, height: 100 }
    ])
  );
  const endpointShapes = new Map([
    ...participantShapes,
    ...endpoints.map((endpoint, index) => [
      endpoint,
      { x: 100 + index * 20, y: 30, width: 100, height: 80 }
    ])
  ]);

  return () => orderParticipantsByMessageFlow(
    collaboration,
    participantShapes,
    endpointShapes
  );
}
