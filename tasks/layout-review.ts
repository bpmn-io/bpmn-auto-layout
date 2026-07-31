import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import url from 'node:url';

import { writeInspectorReport } from '../test/inspector/Report.js';
import { evaluateMetrics } from '../test/metrics/evaluateMetrics.js';

type SnapshotChange =
  | {
    type: 'added';
    previousPath: null;
    path: string;
  }
  | {
    type: 'modified';
    previousPath: string;
    path: string;
  }
  | {
    type: 'removed';
    previousPath: string;
    path: null;
  }
  | {
    type: 'renamed';
    previousPath: string;
    path: string;
  };

type MetricValues = {
  crossings: number;
  bendCount: number;
  overlaps: number;
  edgeShapeIntersections: number;
  detachedDockings: number;
  wrongWayDockings: number;
  nonOrthogonalConnections: number;
  backtrackingConnections: number;
  averageEdgeLength: number;
  edgeSegmentLengthDeviation: number;
  labelShapeOverlaps: number;
  labelEdgeOverlaps: number;
  compactness: number;
  gridAlignment: number;
  branchSymmetry: number;
};

type LayoutReviewMetrics = {
  baseline: MetricValues | null;
  current: MetricValues | null;
  delta: MetricValues | null;
  findings: object | null;
  error: string | null;
};

type LayoutReviewResult = {
  changeType: SnapshotChange['type'];
  diagram: string;
  diagramOutput: string | null;
  diagramSnapshot: string | null;
  diagramSnapshotMatching: boolean | null;
  layoutTiming: null;
  metrics: LayoutReviewMetrics | null;
  name: string;
  previousName: string;
  warnings: [];
};

type LayoutReviewOptions = {
  baseRef: string;
  headRef?: string;
  outputDirectory?: string;
  repositoryDirectory?: string;
};

type LayoutReviewManifest = {
  base: string;
  head: string;
  changeCount: number;
  changes: SnapshotChange[];
};

type GitCommandError = Error & {
  code: number;
  stderr: string;
};

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
}: LayoutReviewOptions): Promise<LayoutReviewManifest> {
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
    repositoryDirectory: string,
    baseRef: string,
    headRef: string,
    change: SnapshotChange
): Promise<LayoutReviewResult> {
  const previousSnapshot = change.previousPath
    ? await readGitFile(repositoryDirectory, baseRef, change.previousPath)
    : null;
  const proposedSnapshot = change.path
    ? await readGitFile(repositoryDirectory, headRef, change.path)
    : null;
  const fixtureName = path.posix.basename(change.path ?? change.previousPath);
  const previousFixtureName = path.posix.basename(
    change.previousPath ?? change.path
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
    ? await evaluateLayoutMetrics(previousSnapshot)
    : null;
  const metrics = proposedSnapshot
    ? await evaluateLayoutMetrics(proposedSnapshot, previousMetrics?.current ?? null)
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

async function findSnapshotChanges(
    repositoryDirectory: string,
    baseRef: string,
    headRef: string
): Promise<SnapshotChange[]> {
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

function parseSnapshotChange(line: string): SnapshotChange {
  const [ status = '', ...paths ] = line.split('\t');
  const kind = status.charAt(0);

  if (kind === 'R') {
    const [ previousPath, path ] = paths;

    if (!previousPath || !path || paths.length !== 2) {
      throw new Error(`Unsupported snapshot change: ${ line }`);
    }

    return {
      type: 'renamed',
      previousPath,
      path
    };
  }

  const [ filePath ] = paths;

  if (!filePath || paths.length !== 1) {
    throw new Error(`Unsupported snapshot change: ${ line }`);
  }

  switch (kind) {
  case 'A':
    return {
      type: 'added',
      previousPath: null,
      path: filePath
    };
  case 'D':
    return {
      type: 'removed',
      previousPath: filePath,
      path: null
    };
  case 'M':
    return {
      type: 'modified',
      previousPath: filePath,
      path: filePath
    };
  default:
    throw new Error(`Unsupported snapshot change: ${ line }`);
  }
}

async function assertFixturesHaveSnapshots(
    repositoryDirectory: string,
    headRef: string
): Promise<void> {
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

async function resolveCommit(repositoryDirectory: string, ref: string): Promise<string> {
  return (await git(repositoryDirectory, [
    'rev-parse',
    '--verify',
    `${ ref }^{commit}`
  ])).trim();
}

async function readGitFile(
    repositoryDirectory: string,
    ref: string,
    filePath: string
): Promise<string> {
  return git(repositoryDirectory, [
    'show',
    `${ ref }:${ filePath }`
  ]);
}

async function readOptionalGitFile(
    repositoryDirectory: string,
    ref: string,
    filePath: string
): Promise<string | null> {
  try {
    return await readGitFile(repositoryDirectory, ref, filePath);
  } catch (error) {
    if (isMissingGitPathError(error, filePath)) {
      return null;
    }

    throw error;
  }
}

async function git(repositoryDirectory: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    [ '-C', repositoryDirectory, ...args ],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }
  );

  if (typeof stdout !== 'string') {
    throw new Error('Git did not produce text output.');
  }

  return stdout;
}

async function evaluateLayoutMetrics(
    xml: string,
    baseline: MetricValues | null = null
): Promise<LayoutReviewMetrics> {
  const metrics: unknown = await evaluateMetrics(xml);

  if (!isLayoutReviewMetrics(metrics)) {
    throw new Error('Metrics evaluation returned an invalid result.');
  }

  if (baseline === null) {
    return metrics;
  }

  return {
    baseline,
    current: metrics.current,
    delta: metrics.current
      ? calculateMetricDelta(metrics.current, baseline)
      : null,
    findings: metrics.findings,
    error: metrics.error
  };
}

function calculateMetricDelta(
    current: MetricValues,
    baseline: MetricValues
): MetricValues {
  return {
    crossings: current.crossings - baseline.crossings,
    bendCount: current.bendCount - baseline.bendCount,
    overlaps: current.overlaps - baseline.overlaps,
    edgeShapeIntersections:
      current.edgeShapeIntersections - baseline.edgeShapeIntersections,
    detachedDockings: current.detachedDockings - baseline.detachedDockings,
    wrongWayDockings: current.wrongWayDockings - baseline.wrongWayDockings,
    nonOrthogonalConnections:
      current.nonOrthogonalConnections - baseline.nonOrthogonalConnections,
    backtrackingConnections:
      current.backtrackingConnections - baseline.backtrackingConnections,
    averageEdgeLength: current.averageEdgeLength - baseline.averageEdgeLength,
    edgeSegmentLengthDeviation:
      current.edgeSegmentLengthDeviation - baseline.edgeSegmentLengthDeviation,
    labelShapeOverlaps:
      current.labelShapeOverlaps - baseline.labelShapeOverlaps,
    labelEdgeOverlaps: current.labelEdgeOverlaps - baseline.labelEdgeOverlaps,
    compactness: current.compactness - baseline.compactness,
    gridAlignment: current.gridAlignment - baseline.gridAlignment,
    branchSymmetry: current.branchSymmetry - baseline.branchSymmetry
  };
}

function isLayoutReviewMetrics(value: unknown): value is LayoutReviewMetrics {
  if (
    !isObject(value) ||
    !hasProperty(value, 'baseline') ||
    !hasProperty(value, 'current') ||
    !hasProperty(value, 'delta') ||
    !hasProperty(value, 'findings') ||
    !hasProperty(value, 'error')
  ) {
    return false;
  }

  return isNullableMetricValues(value.baseline) &&
    isNullableMetricValues(value.current) &&
    isNullableMetricValues(value.delta) &&
    (value.findings === null || isObject(value.findings)) &&
    (value.error === null || typeof value.error === 'string');
}

function isNullableMetricValues(value: unknown): value is MetricValues | null {
  return value === null || isMetricValues(value);
}

function isMetricValues(value: unknown): value is MetricValues {
  if (!isObject(value)) {
    return false;
  }

  return hasNumberProperty(value, 'crossings') &&
    hasNumberProperty(value, 'bendCount') &&
    hasNumberProperty(value, 'overlaps') &&
    hasNumberProperty(value, 'edgeShapeIntersections') &&
    hasNumberProperty(value, 'detachedDockings') &&
    hasNumberProperty(value, 'wrongWayDockings') &&
    hasNumberProperty(value, 'nonOrthogonalConnections') &&
    hasNumberProperty(value, 'backtrackingConnections') &&
    hasNumberProperty(value, 'averageEdgeLength') &&
    hasNumberProperty(value, 'edgeSegmentLengthDeviation') &&
    hasNumberProperty(value, 'labelShapeOverlaps') &&
    hasNumberProperty(value, 'labelEdgeOverlaps') &&
    hasNumberProperty(value, 'compactness') &&
    hasNumberProperty(value, 'gridAlignment') &&
    hasNumberProperty(value, 'branchSymmetry');
}

function isMissingGitPathError(error: unknown, filePath: string): boolean {
  return isGitCommandError(error) &&
    error.code === 128 &&
    error.stderr.includes(`path '${ filePath }'`);
}

function isGitCommandError(error: unknown): error is GitCommandError {
  if (
    !(error instanceof Error) ||
    !hasProperty(error, 'code') ||
    !hasProperty(error, 'stderr')
  ) {
    return false;
  }

  return typeof error.code === 'number' && typeof error.stderr === 'string';
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function hasProperty<Key extends PropertyKey>(
    value: object,
    key: Key
): value is object & { [Property in Key]: unknown } {
  return key in value;
}

function hasNumberProperty<Key extends PropertyKey>(
    value: object,
    key: Key
): value is object & { [Property in Key]: number } {
  return hasProperty(value, key) && typeof value[key] === 'number';
}

function parseArguments(args: readonly string[]): LayoutReviewOptions {
  let baseRef: string | undefined;
  let headRef: string | undefined;
  let outputDirectory: string | undefined;

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];

    if (!value) {
      throw new Error(`Missing value for ${ name }.`);
    }

    if (name === '--base') {
      baseRef = value;
    } else if (name === '--head') {
      headRef = value;
    } else if (name === '--output') {
      outputDirectory = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${ name }`);
    }
  }

  if (!baseRef) {
    throw new Error('--base is required.');
  }

  return {
    baseRef,
    headRef,
    outputDirectory
  };
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
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
