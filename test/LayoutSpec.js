import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { layoutProcess } from 'bpmn-auto-layout';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDirectory = path.join(__dirname, 'fixtures');
const outputDirectory = path.join(__dirname, 'output');
const snapshotsDirectory = path.join(__dirname, 'snapshots');

const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === 'true';


describe('Layout', function() {

  before(() => {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });

    if (UPDATE_SNAPSHOTS) {
      fs.rmSync(snapshotsDirectory, { recursive: true, force: true });
      fs.mkdirSync(snapshotsDirectory, { recursive: true });
    }
  });

  fs.readdirSync(fixturesDirectory)
    .filter(fileName => fileName.endsWith('.bpmn'))
    .forEach(fileName => {
      iit(fileName)(`should layout ${ fileName }`, async function() {

        // given
        const xml = fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');

        // when
        const output = await layoutProcess(xml);

        fs.writeFileSync(path.join(outputDirectory, fileName), output, 'utf8');

        if (UPDATE_SNAPSHOTS) {
          fs.writeFileSync(path.join(snapshotsDirectory, fileName), output, 'utf8');
        } else if (fs.existsSync(path.join(snapshotsDirectory, fileName))) {
          const snapshot = fs.readFileSync(path.join(snapshotsDirectory, fileName), 'utf8');

          // then
          assert.strictEqual(output, snapshot, `Snapshot does not match output for ${ fileName }`);
        }
      });
    });


  after(() => {
    const results = fs.readdirSync(outputDirectory).filter(f => f.endsWith('.bpmn')).reduce((results, fileName) => {

      const diagram = fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');

      const diagramOutput = fs.readFileSync(path.join(outputDirectory, fileName), 'utf8');

      let diagramSnapshot = null;

      if (fs.existsSync(path.join(snapshotsDirectory, fileName))) {
        diagramSnapshot = fs.readFileSync(path.join(snapshotsDirectory, fileName), 'utf8');
      }

      let diagramSnapshotMatching = null;

      if (diagramSnapshot) {

        if (diagramSnapshot === diagramOutput) {
          diagramSnapshotMatching = true;
        } else {
          diagramSnapshotMatching = false;

          console.error(`Snapshot does not match output for ${ fileName }`);
        }
      }

      return [
        ...results,
        {
          diagram,
          diagramOutput,
          diagramSnapshot,
          diagramSnapshotMatching,
          name: fileName
        }
      ];
    }, []);

    const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

    const index = template.replace(
      /\/\* results-start \*\/[\s\S]*\/\* results-end \*\//,
      `const results = ${ JSON.stringify(results) };`
    );

    fs.writeFileSync(path.join(outputDirectory, 'index.html'), index, 'utf8');
  });

  this.afterAll(() => {
    console.log('\nRun `npm run test:inspect` to inspect results.');

    console.log('\nRun `npm run test:update-snapshots` to re-build snapshots.');
  });

});


/**
 * Return the matcher for the spec of the given name.
 *
 * @param {string} fileName
 * @return {any} mochaFN
 */
function iit(fileName) {
  if (fileName.startsWith('ONLY')) {
    return it.only;
  }

  if (fileName.startsWith('SKIP')) {
    return it.skip;
  }

  return it;
}