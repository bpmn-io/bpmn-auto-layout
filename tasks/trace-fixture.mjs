import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, extname, basename } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURES = resolve(ROOT, 'test', 'fixtures');
const DIST = resolve(ROOT, 'example', 'dist');
const TRACES = resolve(ROOT, 'test', 'performance', 'traces');

const TRACE_CATEGORIES = [
  'blink.console',
  'blink.user_timing',
  'devtools.timeline',
  'disabled-by-default-devtools.screenshot',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.invalidationTracking',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-devtools.v8-source-rundown',
  'disabled-by-default-devtools.v8-source-rundown-sources',
  'disabled-by-default-v8.cpu_profiler',
  'disabled-by-default-v8.cpu_profiler.hires',
  'disabled-by-default-v8.inspector',
  'latencyInfo',
  'loading',
  'disabled-by-default-lighthouse',
  'v8.execute',
  'v8'
];

const CONTENT_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json'
};

const fixturePath = resolveFixture(process.argv[2]);
const fixtureXml = await readFile(fixturePath, 'utf8');
let server;
let browser;

try {
  server = await startServer();
  browser = await puppeteer.launch({ headless: true });

  const page = await browser.newPage();

  await page.goto(`http://127.0.0.1:${server.port}/performance.html`, {
    waitUntil: 'networkidle0'
  });
  await page.waitForFunction(() => !!window.__bpmnAutoLayoutPerformance);

  const tracePath = resolve(
    TRACES,
    `Trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  const client = await page.target().createCDPSession();
  const tracingComplete = once(client, 'Tracing.tracingComplete')
    .then(([ event ]) => event);

  await client.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: {
      includedCategories: TRACE_CATEGORIES
    }
  });

  try {
    await page.evaluate(xml => window.__bpmnAutoLayoutPerformance.layout(xml), fixtureXml);
  } finally {
    await client.send('Tracing.end');
  }

  const tracingResult = await tracingComplete;
  const trace = await readTrace(client, tracingResult.stream);

  if (tracingResult.dataLossOccurred) {
    throw new Error('Chrome dropped trace events; no trace was saved.');
  }

  await mkdir(TRACES, { recursive: true });
  await writeFile(tracePath, trace);

  console.log(`Saved trace: ${relative(ROOT, tracePath)}`);
} finally {
  if (browser) {
    await browser.close();
  }
  if (server) {
    await server.close();
  }
}

function resolveFixture(fixtureName) {
  if (!fixtureName || basename(fixtureName) !== fixtureName) {
    throw new Error('Usage: npm run trace:fixture -- <fixture-name>');
  }

  const fileName = fixtureName.endsWith('.bpmn')
    ? fixtureName
    : `${fixtureName}.bpmn`;
  const fixturePath = resolve(FIXTURES, fileName);

  if (relative(FIXTURES, fixturePath).startsWith('..')) {
    throw new Error('Fixture must be inside test/fixtures.');
  }

  return fixturePath;
}

async function startServer() {
  const httpServer = createServer(async (request, response) => {
    try {
      const path = request.url === '/'
        ? resolve(DIST, 'performance.html')
        : resolve(DIST, `.${new URL(request.url, 'http://localhost').pathname}`);

      if (relative(DIST, path).startsWith('..')) {
        response.writeHead(403);
        response.end();
        return;
      }

      const content = await readFile(path);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(path)] || 'application/octet-stream'
      });
      response.end(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.writeHead(404);
        response.end();
        return;
      }

      response.destroy(error);
    }
  });

  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');

  return {
    port: httpServer.address().port,
    close: () => new Promise((resolveClose, rejectClose) => {
      httpServer.close(error => error ? rejectClose(error) : resolveClose());
    })
  };
}

async function readTrace(client, stream) {
  const chunks = [];
  let eof = false;

  while (!eof) {
    const chunk = await client.send('IO.read', { handle: stream });

    chunks.push(chunk.data);
    eof = chunk.eof;
  }

  await client.send('IO.close', { handle: stream });

  return chunks.join('');
}
