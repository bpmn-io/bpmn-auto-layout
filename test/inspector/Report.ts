import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const templateFile = path.resolve(__dirname, '..', 'template.html');

type InspectorReportOptions = { mode?: string };

export function createInspectorReport(
    results: unknown,
    options: InspectorReportOptions = {}
): string {
  const reportConfig = {
    mode: 'test',
    ...options
  };
  const serialized = JSON.stringify({
    reportConfig,
    results
  });

  if (serialized === undefined) {
    throw new Error('Inspector report payload could not be serialized.');
  }

  const payload = Buffer.from(serialized).toString('base64');
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

export function writeInspectorReport(
    results: unknown,
    outputFile: string,
    options: InspectorReportOptions = {}
): string {
  const report = createInspectorReport(results, options);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, report, 'utf8');

  return report;
}
