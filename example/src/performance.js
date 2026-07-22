import Viewer from 'bpmn-js/lib/NavigatedViewer.js';

import { layoutProcess } from '../../lib/index.js';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

import './app.css';

const viewer = new Viewer({
  container: '#viewer'
});

window.__bpmnAutoLayoutPerformance = {
  async layout(xml) {
    const { xml: layoutedXml, warnings } = await layoutProcess(xml);
    const importResult = await viewer.importXML(layoutedXml);

    viewer.get('canvas').zoom('fit-viewport');

    return {
      warnings: [ ...warnings, ...importResult.warnings ]
    };
  }
};
