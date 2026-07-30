import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import url from 'node:url';

import { writeInspectorReport } from '../test/inspector/Report.js';
import { evaluateMetrics } from '../test/metrics/evaluateMetrics.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..'
);

export async function createLayoutReview({
  baseRef,
  headRef = 'HEAD',
  outputDirectory = path.resolve(projectRoot, 'test', 'output', 'layout-review'),
  repositoryDirectory = projectRoot
}) {
  const [ resolvedBase, resolvedHead ] = await Promise.all([
    resolveCommit(repositoryDirectory, baseRef),
    resolveCommit(repositoryDirectory, headRef)
  ]);

  await assertFixturesHaveSnapshots(repositoryDirectory, resolvedHead);

  const changes = await findSnapshotChanges(
    repositoryDirectory,
    resolvedBase,
    resolvedHead
  );
  const results = await Promise.all(changes.map(change => {
    return createReviewResult(
      repositoryDirectory,
      resolvedBase,
      resolvedHead,
      change
    );
  }));
  const manifest = {
    base: resolvedBase,
    head: resolvedHead,
    changeCount: changes.length,
    changes
  };

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
  writeInspectorReport(
    results,
    path.join(outputDirectory, 'index.html'),
    { mode: 'review' }
  );

  return manifest;
}

async function createReviewResult(
    repositoryDirectory,
    baseRef,
    headRef,
    change) {
  const previousSnapshot = change.previousPath
    ? await readGitFile(repositoryDirectory, baseRef, change.previousPath)
    : null;
  const proposedSnapshot = change.path
    ? await readGitFile(repositoryDirectory, headRef, change.path)
    : null;
  const fixtureName = path.posix.basename(change.path || change.previousPath);
  const previousFixtureName = path.posix.basename(
    change.previousPath || change.path
  );
  const diagram = await readOptionalGitFile(
    repositoryDirectory,
    headRef,
    `test/fixtures/${ fixtureName }`
  ) || await readOptionalGitFile(
    repositoryDirectory,
    baseRef,
    `test/fixtures/${ previousFixtureName }`
  );

  if (!diagram) {
    throw new Error(
      `Snapshot change for ${ fixtureName } has no matching fixture.`
    );
  }
  const previousMetrics = previousSnapshot
    ? await evaluateMetrics(previousSnapshot)
    : null;
  const metrics = proposedSnapshot
    ? await evaluateMetrics(proposedSnapshot, previousMetrics?.current)
    : previousMetrics;

  return {
    changeType: change.type,
    diagram,
    diagramOutput: proposedSnapshot || previousSnapshot,
    diagramSnapshot: proposedSnapshot && previousSnapshot
      ? previousSnapshot
      : null,
    diagramSnapshotMatching: proposedSnapshot && previousSnapshot
      ? false
      : null,
    layoutTiming: null,
    metrics,
    name: fixtureName,
    previousName: previousFixtureName,
    warnings: []
  };
}

async function findSnapshotChanges(repositoryDirectory, baseRef, headRef) {
  const output = await git(repositoryDirectory, [
    'diff',
    '--find-renames',
    '--name-status',
    `${ baseRef }...${ headRef }`,
    '--',
    'test/snapshots/*.bpmn'
  ]);

  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseSnapshotChange);
}

function parseSnapshotChange(line) {
  const [ status, ...paths ] = line.split('\t');
  const kind = status[0];

  if (kind === 'R') {
    return {
      type: 'renamed',
      previousPath: paths[0],
      path: paths[1]
    };
  }

  const type = {
    A: 'added',
    D: 'removed',
    M: 'modified'
  }[kind];

  if (!type || paths.length !== 1) {
    throw new Error(`Unsupported snapshot change: ${ line }`);
  }

  return {
    type,
    previousPath: kind === 'A' ? null : paths[0],
    path: kind === 'D' ? null : paths[0]
  };
}

async function assertFixturesHaveSnapshots(repositoryDirectory, headRef) {
  const files = (await git(repositoryDirectory, [
    'ls-tree',
    '-r',
    '--name-only',
    headRef,
    '--',
    'test/fixtures',
    'test/snapshots'
  ])).trim().split(/\r?\n/).filter(Boolean);
  const fixtureNames = files
    .filter(filePath => {
      return path.posix.dirname(filePath) === 'test/fixtures' &&
        filePath.endsWith('.bpmn');
    })
    .map(filePath => path.posix.basename(filePath));
  const snapshotNames = new Set(files
    .filter(filePath => path.posix.dirname(filePath) === 'test/snapshots')
    .map(filePath => path.posix.basename(filePath)));

  for (const fixtureName of fixtureNames) {
    if (!snapshotNames.has(fixtureName)) {
      throw new Error(
        `Fixture test/fixtures/${ fixtureName } needs a matching snapshot.`
      );
    }
  }
}

async function resolveCommit(repositoryDirectory, ref) {
  return (await git(repositoryDirectory, [
    'rev-parse',
    '--verify',
    `${ ref }^{commit}`
  ])).trim();
}

async function readGitFile(repositoryDirectory, ref, filePath) {
  return git(repositoryDirectory, [
    'show',
    `${ ref }:${ filePath }`
  ]);
}

async function readOptionalGitFile(repositoryDirectory, ref, filePath) {
  try {
    return await readGitFile(repositoryDirectory, ref, filePath);
  } catch (error) {
    if (error.code === 128 && error.stderr.includes(`path '${ filePath }'`)) {
      return null;
    }

    throw error;
  }
}

async function git(repositoryDirectory, args) {
  const { stdout } = await execFileAsync(
    'git',
    [ '-C', repositoryDirectory, ...args ],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }
  );

  return stdout;
}

function parseArguments(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];

    if (!value) {
      throw new Error(`Missing value for ${ name }.`);
    }

    if (name === '--base') {
      options.baseRef = value;
    } else if (name === '--head') {
      options.headRef = value;
    } else if (name === '--output') {
      options.outputDirectory = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${ name }`);
    }
  }

  if (!options.baseRef) {
    throw new Error('--base is required.');
  }

  return options;
}

if (
  process.argv[1] &&
  import.meta.url === url.pathToFileURL(process.argv[1]).href
) {
  try {
    const manifest = await createLayoutReview(parseArguments(process.argv.slice(2)));

    console.log(
      `Created layout review for ${ manifest.changeCount } snapshot change(s).`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
