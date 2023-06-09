import fs, { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { layoutProcess } from '../lib/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputDirectory = __dirname + '/generated/';

describe('Layout', function() {

  const filenames = fs.readdirSync('test/fixtures');

  before(() => {

    // Clean result directory
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });
  });

  filenames.forEach(filename => {

    const iit = getIt(filename);

    iit('should layout ' + filename, async function() {
      const xml = fs.readFileSync('test/fixtures/' + filename, 'utf8');

      const result = await layoutProcess(xml);

      fs.writeFileSync(outputDirectory + filename, result, 'utf8');
    });
  });


  after(async () => {

    const generatedFiles = await fsPromises.readdir(outputDirectory);

    const generatedDiagrams = generatedFiles.filter(f => f.endsWith('.bpmn'));

    const originalContents = await Promise.all(
      generatedDiagrams.map(diagram => fsPromises.readFile(__dirname + '/fixtures/' + diagram, 'utf8'))
    );

    const generatedContents = await Promise.all(
      generatedDiagrams.map(diagram => fsPromises.readFile(outputDirectory + diagram, 'utf8'))
    );

    const generated = generatedContents.map((contents, idx) => {

      return {
        diagram: generatedDiagrams[idx],
        generatedContents: generatedContents[idx],
        originalContents: originalContents[idx]
      };
    });

    const config = JSON.stringify(generated);

    const html = `
<html>
  <head>
    <title>bpmn-auto-layouter - visual tests</title>
    <style>
      .title {
        font-family: monospace;
        margin-bottom: 10px;
        margin-top: 10px;
        font-weight: bold;
      }

      .container {
        height: 400px;
        width: 48%;
        display: inline-block;
        position: relative;
        border: solid 1px #CCC;
      }

      .container + .container {
        margin-left: 5px;
      }

      .parent {
        margin-bottom: 30px;
      }
    </style>
  </head>
  <body>
    <script src="https://unpkg.com/bpmn-js/dist/bpmn-viewer.production.min.js"></script>
    <script>
      const config = ${config};

      for (const { diagram, generatedContents, originalContents } of config) {

        const parent = document.createElement('div');
        parent.className = 'parent';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = 'test/generated/' + diagram;

        const containerParent = document.createElement('div');
        containerParent.className = 'container-parent';

        const containerBefore = document.createElement('div');
        containerBefore.className = 'container before';

        const containerAfter = document.createElement('div');
        containerAfter.className = 'container after';

        parent.appendChild(title);
        parent.appendChild(containerParent);

        containerParent.appendChild(containerBefore);
        containerParent.appendChild(containerAfter);

        document.body.appendChild(parent);

        const originalViewer = new BpmnJS({
          container: containerBefore
        });

        originalViewer.importXML(originalContents, function(err) {
          if (err) {
            console.log('ERROR: %s failed to import', diagram, err);
          }

          originalViewer.get('canvas').zoom('fit-viewport');
        });


        const generatedViewer = new BpmnJS({
          container: containerAfter
        });

        generatedViewer.importXML(generatedContents, function(err) {
          if (err) {
            console.log('ERROR: %s failed to import', diagram, err);
          }

          generatedViewer.get('canvas').zoom('fit-viewport');
        });
      }
    </script>
  </body>
</html>`;

    await fsPromises.writeFile(__dirname + '/generated/test.html', html, 'utf8');
  });

});

function getIt(name) {
  if (name.startsWith('ONLY')) {
    return it.only;
  }

  if (name.startsWith('SKIP')) {
    return it.skip;
  }

  return it;
}