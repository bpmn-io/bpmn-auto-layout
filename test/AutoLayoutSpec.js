const AutoLayout = require('../');

const autoLayout = new AutoLayout();

const fs = require('fs').promises;

async function cleanDI(diagramXML) {

  const BpmnModdle = require('bpmn-moddle');

  const moddle = new BpmnModdle();

  return new Promise(function(resolve, reject) {

    moddle.fromXML(diagramXML, function(err, definitions) {

      if (err) {
        return reject(err);
      }

      definitions.diagrams = [];

      moddle.toXML(definitions, function(err, xml) {

        if (err) {
          return reject(err);
        }

        return resolve(xml);
      });
    });
  });
}

async function test(diagramName) {

  const diagramXML = await fs.readFile(__dirname + '/fixtures/' + diagramName, 'utf8');

  const cleanedXML = await cleanDI(diagramXML);

  const layoutedDiagramXML = await autoLayout.layoutProcess(cleanedXML);

  await fs.mkdir(__dirname + '/generated', { recursive: true });
  await fs.writeFile(__dirname + '/generated/' + diagramName, layoutedDiagramXML);
}

describe('bpmn-auto-layout', function() {

  describe('should layout', function() {

    it.skip('simple', async function() {
      await test('simple.bpmn');
    });


    it('process-diagram', async function() {
      await test('process-diagram.bpmn');
    });


    it('parallel flows', function() {

    });


    it('multiple start events', async function() {
      await test('multiple-start-events.bpmn');
    });


    it('nested sub-process', async function() {
      await test('nested-sub-processes.bpmn');
    });


    it.skip('collaboration and message flows', async function() {
      await test('collaboration-message-flows.bpmn');
    });


    it.skip('boundary events', async function() {
      await test('boundary-events.bpmn');
    });


    it.skip('event sub-process', async function() {
      await test('event-sub-process.bpmn');
    });

  });


  after(async () => {

    const generatedFiles = await fs.readdir(__dirname + '/generated');

    const generatedDiagrams = generatedFiles.filter(f => f.endsWith('.bpmn'));

    const originalContents = await Promise.all(
      generatedDiagrams.map(diagram => fs.readFile(__dirname + '/fixtures/' + diagram, 'utf8'))
    );

    const generatedContents = await Promise.all(
      generatedDiagrams.map(diagram => fs.readFile(__dirname + '/generated/' + diagram, 'utf8'))
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

    await fs.writeFile(__dirname + '/generated/test.html', html, 'utf8');
  });

});