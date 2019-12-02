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

    it('basic', async function() {
      await test('diagram_1.bpmn');
    });


    it('basic (2)', async function() {
      await test('diagram_2.bpmn');
    });


    it.skip('collaboration and message flows', async function() {
      await test('collaboration-message-flows.bpmn');
    });


    it('parallel flows', function() {

    });


    it('multiple start events', async function() {
      await test('multiple-start-events.bpmn');
    });


    it('nested sub-process', function() {

    });


    it('collaboration diagram', function() {

    });


    it('boundary events', function() {

    });


    it('event-based sub-process', function() {

    });

  });


  after(async () => {

    const generatedFiles = await fs.readdir(__dirname + '/generated');

    const generatedDiagrams = generatedFiles.filter(f => f.endsWith('.bpmn'));

    const diagramContents = await Promise.all(
      generatedDiagrams.map(diagram => fs.readFile(__dirname + '/generated/' + diagram, 'utf8'))
    );

    const generated = diagramContents.map((contents, idx) => {

      return {
        diagram: generatedDiagrams[idx],
        contents
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
        width: 100%;
        position: relative;
        border: solid 1px #CCC;
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

      for (const { diagram, contents } of config) {

        const parent = document.createElement('div');
        parent.className = 'parent';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = 'test/generated/' + diagram;

        const container = document.createElement('div');
        container.className = 'container';

        parent.appendChild(title);
        parent.appendChild(container);

        document.body.appendChild(parent);

        const viewer = new BpmnJS({ container });

        viewer.importXML(contents, function(err) {
          if (err) {
            console.log('ERROR: %s failed to import', diagram, err);
          }

          viewer.get('canvas').zoom('fit-viewport');
        });
      }
    </script>
  </body>
</html>`;

    await fs.writeFile(__dirname + '/generated/generated.html', html, 'utf8');
  });

});