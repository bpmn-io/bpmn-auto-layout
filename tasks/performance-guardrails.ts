import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';

import { layoutProcess } from '../dist/index.js';
import {
  orderParticipantsByMessageFlow
} from '../lib/layout/collaboration/ordering/ParticipantOrdering.js';
import { calculateStatistics } from './benchmark-util.js';

import type { Rect } from 'diagram-js/lib/util/Types.js';

import type { BpmnElement } from '../lib/layout/bpmn/Types.js';

type Budget = {
  name: string;
  operation: () => void | Promise<unknown>;
  warmups: number;
  iterations: number;
  maxP50Ms: number;
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budgets: Budget[] = [
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
}: Budget): Promise<void> {
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

async function createFixtureOperation(fileName: string) {
  const xml = await readFile(
    resolve(projectRoot, 'test', 'fixtures', fileName),
    'utf8'
  );

  return () => layoutProcess(xml);
}

function createParticipantOrderingOperation(participantCount: number): () => void {
  const moddle = new BpmnModdle();
  const processes = Array.from({ length: participantCount }, (_, index) => {
    return moddle.create('bpmn:Process', {
      id: `Process_${ index }`
    });
  });
  const participants = processes.map((processRef, index) => {
    return moddle.create('bpmn:Participant', {
      id: `Participant_${ index }`,
      processRef
    });
  });
  const endpoints = processes.map((process, index) => {
    const endpoint = moddle.create('bpmn:Task', {
      id: `Endpoint_${ index }`
    });

    endpoint.$parent = process;
    process.flowElements = [ endpoint ];

    return endpoint;
  });
  const messageFlows = endpoints.slice(1).map((targetRef, index) => {
    return moddle.create('bpmn:MessageFlow', {
      id: `MessageFlow_${ index }`,
      sourceRef: endpoints[index],
      targetRef
    });
  });
  const collaboration = moddle.create('bpmn:Collaboration', {
    participants,
    messageFlows
  });
  const participantShapes = new Map<BpmnElement, Rect>();
  const endpointShapes = new Map<BpmnElement, Rect>();

  for (const [ index, participant ] of participants.entries()) {
    participant.$parent = collaboration;
    participantShapes.set(participant, {
      x: 0,
      y: index * 180,
      width: 500,
      height: 100
    });
    endpointShapes.set(participant, {
      x: 0,
      y: index * 180,
      width: 500,
      height: 100
    });
  }

  for (const [ index, endpoint ] of endpoints.entries()) {
    endpointShapes.set(endpoint, {
      x: 100 + index * 20,
      y: 30,
      width: 100,
      height: 80
    });
  }

  for (const messageFlow of messageFlows) {
    messageFlow.$parent = collaboration;
  }

  return () => {
    orderParticipantsByMessageFlow(
      collaboration,
      participantShapes,
      endpointShapes
    );
  };
}
