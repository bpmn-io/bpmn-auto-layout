import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';

import { convertAll } from 'bpmn-to-image';

import { layoutProcess } from '../dist/index.js';

const projectRoot = resolve(import.meta.dirname, '..');
const fixturesDirectory = resolve(projectRoot, 'test', 'fixtures');
const renderedDirectory = resolve(projectRoot, 'test', 'output', 'rendered');

const [ fixtureArgument ] = process.argv.slice(2);

if (!fixtureArgument) {
  throw new Error('Usage: npm run render:fixture -- <fixture-name-or-path>');
}

const fixturePath = resolve(fixturesDirectory, fixtureArgument.endsWith('.bpmn') ? fixtureArgument : `${fixtureArgument}.bpmn`);
const fixtureRelativePath = relative(fixturesDirectory, fixturePath);

if (fixtureRelativePath.startsWith(`..${sep}`) || fixtureRelativePath === '..') {
  throw new Error('Fixture must be below test/fixtures.');
}

if (fixtureRelativePath.split(sep)[0] === 'failures') {
  throw new Error('Failure fixtures do not produce renderable layout output.');
}

try {
  await stat(fixturePath);
} catch {
  throw new Error(`Fixture not found: ${fixtureRelativePath}`);
}

const fixtureXml = await readFile(fixturePath, 'utf8');
const layoutXml = await layoutProcess(fixtureXml);
const fixtureName = basename(fixtureRelativePath, '.bpmn');

await mkdir(renderedDirectory, { recursive: true });

const renderedBpmnPath = resolve(renderedDirectory, `${fixtureName}.bpmn`);
const inputPngPath = resolve(renderedDirectory, `${fixtureName}.input.png`);
const inputSvgPath = resolve(renderedDirectory, `${fixtureName}.input.svg`);
const renderedPngPath = resolve(renderedDirectory, `${fixtureName}.png`);
const renderedSvgPath = resolve(renderedDirectory, `${fixtureName}.svg`);

await writeFile(renderedBpmnPath, layoutXml, 'utf8');

await convertAll([ {
  input: fixturePath,
  outputs: [ inputPngPath, inputSvgPath ]
}, {
  input: renderedBpmnPath,
  outputs: [ renderedPngPath, renderedSvgPath ]
} ], {
  footer: false,
  title: false
});

console.log(`Rendered ${fixtureRelativePath}`);
console.log(`  ${relative(projectRoot, inputPngPath)}`);
console.log(`  ${relative(projectRoot, inputSvgPath)}`);
console.log(`  ${relative(projectRoot, renderedPngPath)}`);
console.log(`  ${relative(projectRoot, renderedSvgPath)}`);