import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { afterEach, beforeEach, describe, it } from 'mocha';

import { createLayoutReview } from '../tasks/layout-review.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const fixtureName = 'scenario.linear.bpmn';
const testOutput = path.join(__dirname, 'output');

type TimedTestContext = {
  timeout(milliseconds: number): void;
};

type ReviewResult = {
  diagramSnapshot: string | null;
  diagramOutput: string | null;
  changeType: string;
  metrics: ReviewMetrics | null;
};

type ReviewMetrics = {
  baseline: object | null;
  current: object | null;
  delta: object | null;
  findings: object | null;
  error: string | null;
};

type ReviewPayload = {
  reportConfig: { mode: string };
  results: ReviewResult[];
};
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', fixtureName),
  'utf8'
);
const snapshot = fs.readFileSync(
  path.join(__dirname, 'snapshots', fixtureName),
  'utf8'
);

describe('Layout review', function(this: TimedTestContext) {

  this.timeout(60000);

  let repositoryDirectory: string;

  beforeEach(function() {
    fs.mkdirSync(testOutput, { recursive: true });
    repositoryDirectory = fs.mkdtempSync(
      path.join(testOutput, 'bpmn-layout-review-')
    );
    git('init');
    write(`test/fixtures/${ fixtureName }`, fixture);
    write(`test/snapshots/${ fixtureName }`, snapshot);
    git('add', '.');
    commit('base');
  });

  afterEach(async function() {
    try {
      await fs.promises.rm(repositoryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      });
    } catch (error) {
      console.warn(
        `Could not remove temporary layout-review repository ${repositoryDirectory}: ${ String(error) }`
      );
    }
  });

  it('should compare base and head snapshots', async function() {
    const baseRef = git('rev-parse', 'HEAD').trim();
    const proposedSnapshot = snapshot + '\n';

    write(`test/snapshots/${ fixtureName }`, proposedSnapshot);
    git('add', '.');
    commit('change snapshot');
    const headRef = git('rev-parse', 'HEAD').trim();
    const outputDirectory = path.join(repositoryDirectory, 'review');

    const manifest = await createLayoutReview({
      baseRef,
      headRef,
      outputDirectory,
      repositoryDirectory
    });
    const report = fs.readFileSync(
      path.join(outputDirectory, 'index.html'),
      'utf8'
    );
    const payload = parseReviewPayload(report);
    const result = getRequired(payload.results[0]);

    assert.strictEqual(manifest.changeCount, 1);
    assert.deepStrictEqual(manifest.changes, [ {
      type: 'modified',
      previousPath: `test/snapshots/${ fixtureName }`,
      path: `test/snapshots/${ fixtureName }`
    } ]);
    assert.strictEqual(payload.reportConfig.mode, 'review');
    assert.strictEqual(result.diagramSnapshot, snapshot);
    assert.strictEqual(result.diagramOutput, proposedSnapshot);
    assert.strictEqual(result.changeType, 'modified');
    assert.ok(result.metrics);
    assert.ok(result.metrics.baseline);
    assert.ok(result.metrics.current);
    assert.ok(result.metrics.delta);
    assert.ok(report.includes('Snapshot changes'));
  });

  it('should reject a new fixture without a snapshot', async function() {
    const baseRef = git('rev-parse', 'HEAD').trim();

    write('test/fixtures/new-fixture.bpmn', fixture);
    git('add', '.');
    commit('add fixture');
    const headRef = git('rev-parse', 'HEAD').trim();

    await assert.rejects(
      createLayoutReview({
        baseRef,
        headRef,
        outputDirectory: path.join(repositoryDirectory, 'review'),
        repositoryDirectory
      }),
      /Fixture test\/fixtures\/new-fixture\.bpmn needs a matching snapshot/
    );
  });

  it('should compare renamed fixtures and snapshots', async function() {
    const baseRef = git('rev-parse', 'HEAD').trim();
    const renamedFixture = 'scenario.renamed-linear.bpmn';

    fs.renameSync(
      path.join(repositoryDirectory, 'test', 'fixtures', fixtureName),
      path.join(repositoryDirectory, 'test', 'fixtures', renamedFixture)
    );
    fs.renameSync(
      path.join(repositoryDirectory, 'test', 'snapshots', fixtureName),
      path.join(repositoryDirectory, 'test', 'snapshots', renamedFixture)
    );
    git('add', '-A');
    commit('rename fixture');
    const headRef = git('rev-parse', 'HEAD').trim();

    const manifest = await createLayoutReview({
      baseRef,
      headRef,
      outputDirectory: path.join(repositoryDirectory, 'review'),
      repositoryDirectory
    });

    assert.deepStrictEqual(manifest.changes, [ {
      type: 'renamed',
      previousPath: `test/snapshots/${ fixtureName }`,
      path: `test/snapshots/${ renamedFixture }`
    } ]);
  });

  function write(relativePath: string, contents: string): void {
    const filePath = path.join(repositoryDirectory, relativePath);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
  }

  function git(...args: string[]): string {
    return execFileSync('git', [ '-C', repositoryDirectory, ...args ], {
      encoding: 'utf8',
      stdio: [ 'ignore', 'pipe', 'pipe' ]
    });
  }

  function commit(message: string): void {
    git(
      '-c', 'user.email=layout-review@example.com',
      '-c', 'user.name=Layout Review',
      '-c', 'commit.gpgSign=false',
      'commit',
      '-m', message
    );
  }
});

function parseReviewPayload(report: string): ReviewPayload {
  const encodedPayload = getRequired(/atob\('([^']+)'\)/.exec(report)?.[1]);
  const payload: unknown = JSON.parse(Buffer.from(
    encodedPayload,
    'base64'
  ).toString('utf8'));

  if (!isReviewPayload(payload)) {
    throw new Error('Expected a layout review payload.');
  }

  return payload;
}

function isReviewPayload(value: unknown): value is ReviewPayload {
  return isRecord(value) && isRecord(value.reportConfig) &&
    typeof value.reportConfig.mode === 'string' &&
    Array.isArray(value.results) && value.results.every(isReviewResult);
}

function isReviewResult(value: unknown): value is ReviewResult {
  return isRecord(value) &&
    (typeof value.diagramSnapshot === 'string' || value.diagramSnapshot === null) &&
    (typeof value.diagramOutput === 'string' || value.diagramOutput === null) &&
    typeof value.changeType === 'string' &&
    isReviewMetrics(value.metrics);
}

function isReviewMetrics(value: unknown): value is ReviewMetrics | null {
  return value === null || (
    isRecord(value) &&
    (value.baseline === null || isRecord(value.baseline)) &&
    (value.current === null || isRecord(value.current)) &&
    (value.delta === null || isRecord(value.delta)) &&
    (value.findings === null || isRecord(value.findings)) &&
    (value.error === null || typeof value.error === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected a layout review value.');
  }

  return value;
}
