import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { layoutProcess } from '../lib/index.js';

interface HelpOptions {
  type: 'help';
}

interface VersionOptions {
  type: 'version';
}

interface LayoutOptions {
  type: 'layout';
  input: string;
  output: string | undefined;
  stdout: boolean;
}

interface Input {
  path: string;
  xml: string;
  mode: number | undefined;
}

interface PackageMetadata {
  version: string;
}

type Options = HelpOptions | VersionOptions | LayoutOptions;

class UsageError extends Error {
  exitCode = 2;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  if (options.type === 'help') {
    process.stdout.write(usage());
    return;
  }

  if (options.type === 'version') {
    process.stdout.write(`${await readPackageVersion()}\n`);
    return;
  }

  const input = await readInput(options.input);
  const { xml, warnings } = await layoutProcess(input.xml);

  for (const warning of warnings) {
    process.stderr.write(`${JSON.stringify({
      code: warning.code,
      elementId: warning.elementId,
      message: warning.message,
      relatedElementIds: warning.relatedElementIds
    })}\n`);
  }

  if (options.stdout || input.path === '-') {
    process.stdout.write(xml);
    return;
  }

  await writeAtomically(options.output || input.path, xml, input.mode);
}

function parseArguments(arguments_: string[]): Options {
  const options: LayoutOptions = {
    type: 'layout',
    input: '',
    output: undefined,
    stdout: false
  };

  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];

    if (argument === '--help' || argument === '-h') {
      return { type: 'help' };
    }

    if (argument === '--version' || argument === '-v') {
      return { type: 'version' };
    }

    if (argument === '--stdout') {
      options.stdout = true;
      continue;
    }

    if (argument === '--output' || argument === '-o') {
      options.output = arguments_[++index];

      if (!options.output) {
        throw usageError(`Missing output path after "${argument}".`);
      }

      continue;
    }

    if (argument.startsWith('-') && argument !== '-') {
      throw usageError(`Unknown option "${argument}".`);
    }

    if (options.input) {
      throw usageError('Expected exactly one input path.');
    }

    options.input = argument;
  }

  if (!options.input) {
    throw usageError('Missing input path.');
  }

  if (options.stdout && options.output) {
    throw usageError('Use either "--stdout" or "--output", not both.');
  }

  return options;
}

async function readInput(inputPath: string): Promise<Input> {
  if (inputPath === '-') {
    return {
      path: '-',
      xml: await readStandardInput(),
      mode: undefined
    };
  }

  const [ xml, stat ] = await Promise.all([
    fs.readFile(inputPath, 'utf8'),
    fs.stat(inputPath)
  ]);

  return {
    path: inputPath,
    xml,
    mode: stat.mode & 0o777
  };
}

async function readStandardInput(): Promise<string> {
  let input = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return input;
}

async function writeAtomically(
    outputPath: string,
    xml: string,
    mode: number | undefined
): Promise<void> {
  const directory = path.dirname(outputPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(outputPath)}.${randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(temporaryPath, xml, {
      encoding: 'utf8',
      mode
    });
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readPackageVersion(): Promise<string> {
  const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const content = await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8');
  const packageMetadata: unknown = JSON.parse(content);

  if (!isPackageMetadata(packageMetadata)) {
    throw new Error('Unable to read package version.');
  }

  return packageMetadata.version;
}

function isPackageMetadata(value: unknown): value is PackageMetadata {
  return typeof value === 'object' && value !== null &&
    'version' in value && typeof value.version === 'string';
}

function usageError(message: string): UsageError {
  return new UsageError(`${message}\n\n${usage()}`);
}

function usage(): string {
  return `Usage: bpmn-auto-layout <input.bpmn> [options]

Layout a BPMN diagram and replace its input file atomically.

Options:
  -o, --output <path>  Write the result to a different file.
      --stdout         Write the result to standard output.
  -h, --help           Show this help text.
  -v, --version        Show the version.

Use "-" as the input path to read BPMN XML from standard input.
`;
}

main().catch(error => {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const code = getErrorCode(normalizedError);
  const prefix = code
    ? `${normalizedError.name} [${code}]`
    : normalizedError.name === 'Error'
      ? ''
      : normalizedError.name;

  process.stderr.write(`bpmn-auto-layout: ${prefix}${prefix ? ': ' : ''}${normalizedError.message}\n`);
  process.exitCode = getExitCode(normalizedError) || 1;
});

function getErrorCode(error: Error): string | undefined {
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
}

function getExitCode(error: Error): number | undefined {
  if ('exitCode' in error && typeof error.exitCode === 'number') {
    return error.exitCode;
  }
}
