import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const templateFile = path.resolve(__dirname, '..', 'template.html');

export function createInspectorReport(results, options = {}) {
  const reportConfig = {
    mode: 'test',
    ...options
  };
  const payload = Buffer.from(JSON.stringify({
    reportConfig,
    results
  })).toString('base64');
  const template = fs.readFileSync(templateFile, 'utf8');
  const report = template.replace(
    /\/\* results-start \*\/[\s\S]*\/\* results-end \*\//,
    `const { reportConfig, results } = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${ payload }'), character => character.charCodeAt(0))));`
  );

  if (report === template) {
    throw new Error('Inspector template does not contain a results marker.');
  }

  return report;
}

export function writeInspectorReport(results, outputFile, options = {}) {
  const report = createInspectorReport(results, options);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, report, 'utf8');

  return report;
}
