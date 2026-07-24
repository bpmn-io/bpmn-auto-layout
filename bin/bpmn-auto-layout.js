#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { layoutProcess } from '../dist/index.js';

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await fs.readFile(
  path.join(packageDirectory, 'package.json'),
  'utf8'
));

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  if (options.version) {
    process.stdout.write(`${packageJson.version}\n`);
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

function parseArguments(arguments_) {
  const options = {
    input: null,
    output: null,
    stdout: false
  };

  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];

    if (argument === '--help' || argument === '-h') {
      return { help: true };
    }

    if (argument === '--version' || argument === '-v') {
      return { version: true };
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

async function readInput(inputPath) {
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

async function readStandardInput() {
  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return input;
}

async function writeAtomically(outputPath, xml, mode) {
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

function usageError(message) {
  const error = new Error(`${message}\n\n${usage()}`);

  error.exitCode = 2;

  return error;
}

function usage() {
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
  const prefix = error.code
    ? `${error.name} [${error.code}]`
    : error.name === 'Error'
      ? ''
      : error.name;

  process.stderr.write(`bpmn-auto-layout: ${prefix}${prefix ? ': ' : ''}${error.message}\n`);
  process.exitCode = error.exitCode || 1;
});
