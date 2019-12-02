var AutoLayout = require('../');

var autoLayout = new AutoLayout();

var fs = require('fs').promises;


describe('bpmn-auto-layout', function() {

  describe('should layout', function() {

    it('basic', async function() {

      const diagramXML = await fs.readFile(__dirname + '/fixtures/diagram_2.bpmn', 'utf8');

      const layoutedDiagramXML = await autoLayout.layoutProcess(diagramXML);

      await fs.mkdir(__dirname + '/generated', { recursive: true });
      await fs.writeFile(__dirname + '/generated/diagram_2.bpmn', layoutedDiagramXML);
    });


    it('parallel flows', function() {

    });


    it('multiple start events', function() {

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

});