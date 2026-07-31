import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, it } from 'mocha';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, '..', 'dist', 'bpmn-auto-layout.js');
const fixtures = path.join(__dirname, 'fixtures');
const testOutput = path.join(__dirname, 'output');

type CliResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type LayoutWarning = {
  code: string;
};

describe('CLI', function() {

  let temporaryDirectory: string;

  beforeEach(async function() {
    await fs.mkdir(testOutput, { recursive: true });
    temporaryDirectory = await fs.mkdtemp(
      path.join(testOutput, 'bpmn-auto-layout-cli-')
    );
  });

  afterEach(async function() {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('should replace a BPMN file in place by default', async function() {
    const input = await copyFixture('scenario.simple.bpmn');
    const original = await fs.readFile(input, 'utf8');

    const result = await runCli([ input ]);
    const output = await fs.readFile(input, 'utf8');

    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, '');
    assert.notStrictEqual(output, original);
    assert.ok(output.includes('bpmndi:BPMNDiagram'));
  });

  it('should write layout XML to stdout without changing the input', async function() {
    const input = await copyFixture('scenario.simple.bpmn');
    const original = await fs.readFile(input, 'utf8');

    const result = await runCli([ input, '--stdout' ]);

    assert.strictEqual(result.code, 0);
    assert.strictEqual(await fs.readFile(input, 'utf8'), original);
    assert.notStrictEqual(result.stdout, original);
    assert.ok(result.stdout.includes('bpmndi:BPMNDiagram'));
  });

  it('should write layout XML to an explicit output file', async function() {
    const input = await copyFixture('scenario.simple.bpmn');
    const output = path.join(temporaryDirectory, 'output.bpmn');
    const original = await fs.readFile(input, 'utf8');

    const result = await runCli([ input, '--output', output ]);

    assert.strictEqual(result.code, 0);
    assert.strictEqual(await fs.readFile(input, 'utf8'), original);
    assert.ok((await fs.readFile(output, 'utf8')).includes('bpmndi:BPMNDiagram'));
  });

  it('should read from stdin and write to stdout', async function() {
    const input = await fs.readFile(
      path.join(fixtures, 'scenario.simple.bpmn'),
      'utf8'
    );

    const result = await runCli([ '-' ], input);

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('bpmndi:BPMNDiagram'));
  });

  it('should emit structured layout warnings to stderr', async function() {
    const result = await runCli([
      path.join(fixtures, 'process.application-processing.bpmn'),
      '--stdout'
    ]);
    const warnings = result.stderr.trim().split('\n').map(parseWarning);

    assert.strictEqual(result.code, 0);
    assert.ok(warnings.some(warning => warning.code === 'DI_NOT_CREATED'));
  });

  it('should expose help, version, and usage failures', async function() {
    const help = await runCli([ '--help' ]);
    const version = await runCli([ '--version' ]);
    const invalid = await runCli([ '--unknown' ]);

    assert.strictEqual(help.code, 0);
    assert.ok(help.stdout.startsWith('Usage: bpmn-auto-layout'));
    assert.strictEqual(version.code, 0);
    assert.match(version.stdout, /^\d+\.\d+\.\d+/);
    assert.strictEqual(invalid.code, 2);
    assert.match(invalid.stderr, /Unknown option "--unknown"/);
  });

  it('should preserve the input file when layout fails', async function() {
    const input = await copyFixture('failures/invalid-sequence-flow-endpoint.bpmn');
    const original = await fs.readFile(input, 'utf8');

    const result = await runCli([ input ]);

    assert.strictEqual(result.code, 1);
    assert.strictEqual(await fs.readFile(input, 'utf8'), original);
    assert.match(result.stderr, /LayoutError/);
  });

  it('should report missing input files', async function() {
    const result = await runCli([
      path.join(temporaryDirectory, 'missing.bpmn')
    ]);

    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /ENOENT/);
  });

  async function copyFixture(name: string): Promise<string> {
    const source = path.join(fixtures, name);
    const target = path.join(temporaryDirectory, path.basename(name));

    await fs.copyFile(source, target);

    return target;
  }
});

function runCli(arguments_: string[], input?: string): Promise<CliResult> {
  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn(process.execPath, [ cli, ...arguments_ ], {
      stdio: [ 'pipe', 'pipe', 'pipe' ]
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(input);
  });
}

function parseWarning(line: string): LayoutWarning {
  const value: unknown = JSON.parse(line);

  if (!isLayoutWarning(value)) {
    throw new Error('Expected a structured layout warning.');
  }

  return value;
}

function isLayoutWarning(value: unknown): value is LayoutWarning {
  return typeof value === 'object' && value !== null &&
    'code' in value && typeof value.code === 'string';
}
