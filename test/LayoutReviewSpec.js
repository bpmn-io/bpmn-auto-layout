import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { createLayoutReview } from '../tasks/layout-review.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const fixtureName = 'scenario.linear.bpmn';
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', fixtureName),
  'utf8'
);
const snapshot = fs.readFileSync(
  path.join(__dirname, 'snapshots', fixtureName),
  'utf8'
);

describe('Layout review', function() {

  this.timeout(60000);

  let repositoryDirectory;

  beforeEach(function() {
    repositoryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bpmn-layout-review-')
    );
    git('init');
    write(`test/fixtures/${ fixtureName }`, fixture);
    write(`test/snapshots/${ fixtureName }`, snapshot);
    git('add', '.');
    commit('base');
  });

  afterEach(function() {
    fs.rmSync(repositoryDirectory, { recursive: true, force: true });
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
    const payload = JSON.parse(Buffer.from(
      /atob\('([^']+)'\)/.exec(report)[1],
      'base64'
    ).toString('utf8'));

    assert.strictEqual(manifest.changeCount, 1);
    assert.deepStrictEqual(manifest.changes, [ {
      type: 'modified',
      previousPath: `test/snapshots/${ fixtureName }`,
      path: `test/snapshots/${ fixtureName }`
    } ]);
    assert.strictEqual(payload.reportConfig.mode, 'review');
    assert.strictEqual(payload.results[0].diagramSnapshot, snapshot);
    assert.strictEqual(payload.results[0].diagramOutput, proposedSnapshot);
    assert.strictEqual(payload.results[0].changeType, 'modified');
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

  function write(relativePath, contents) {
    const filePath = path.join(repositoryDirectory, relativePath);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
  }

  function git(...args) {
    return execFileSync('git', [ '-C', repositoryDirectory, ...args ], {
      encoding: 'utf8',
      stdio: [ 'ignore', 'pipe', 'pipe' ]
    });
  }

  function commit(message) {
    return git(
      '-c', 'user.email=layout-review@example.com',
      '-c', 'user.name=Layout Review',
      '-c', 'commit.gpgSign=false',
      'commit',
      '-m', message
    );
  }
});
