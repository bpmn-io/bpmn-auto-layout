import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

import type { Protocol } from 'devtools-protocol';
import type { Browser, CDPSession } from 'puppeteer';

type TraceServer = {
  port: number;
  close(): Promise<void>;
};

type TracingCompleteWithStream = Protocol.Tracing.TracingCompleteEvent & {
  stream: Protocol.IO.StreamHandle;
};

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

const CONTENT_TYPES = new Map<string, string>([
  [ '.css', 'text/css' ],
  [ '.html', 'text/html' ],
  [ '.js', 'text/javascript' ],
  [ '.map', 'application/json' ]
]);

const fixturePath = resolveFixture(process.argv[2]);
const fixtureXml = await readFile(fixturePath, 'utf8');
let server: TraceServer | undefined;
let browser: Browser | undefined;

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
  const tracingComplete = waitForTracingComplete(client);

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

  if (!hasTraceStream(tracingResult)) {
    throw new Error('Chrome did not return a trace stream; no trace was saved.');
  }

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

function resolveFixture(fixtureName: string | undefined): string {
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

async function startServer(): Promise<TraceServer> {
  const httpServer = createServer(async (request, response) => {
    try {
      const requestUrl = request.url || '/';
      const path = requestUrl === '/'
        ? resolve(DIST, 'performance.html')
        : resolve(DIST, `.${new URL(requestUrl, 'http://localhost').pathname}`);

      if (relative(DIST, path).startsWith('..')) {
        response.writeHead(403);
        response.end();
        return;
      }

      const content = await readFile(path);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES.get(extname(path)) || 'application/octet-stream'
      });
      response.end(content);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) {
        response.writeHead(404);
        response.end();
        return;
      }

      response.destroy(
        error instanceof Error
          ? error
          : new Error('Unable to serve the trace page.', { cause: error })
      );
    }
  });

  httpServer.listen(0, '127.0.0.1');
  await new Promise<void>(resolveListening => {
    httpServer.once('listening', resolveListening);
  });

  const address = httpServer.address();

  if (!address || typeof address === 'string') {
    throw new Error('Trace server did not bind to a TCP port.');
  }

  return {
    port: address.port,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      httpServer.close(error => error ? rejectClose(error) : resolveClose());
    })
  };
}

function waitForTracingComplete(
    client: CDPSession
): Promise<Protocol.Tracing.TracingCompleteEvent> {
  return new Promise(resolveTracingComplete => {
    client.once('Tracing.tracingComplete', resolveTracingComplete);
  });
}

function hasTraceStream(
    tracingComplete: Protocol.Tracing.TracingCompleteEvent
): tracingComplete is TracingCompleteWithStream {
  return tracingComplete.stream !== undefined;
}

async function readTrace(
    client: CDPSession,
    stream: Protocol.IO.StreamHandle
): Promise<string> {
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

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
