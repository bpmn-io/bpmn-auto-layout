import Viewer from 'bpmn-js/lib/NavigatedViewer.js';
import Modeler from 'bpmn-js/lib/Modeler.js';

import { layoutProcess } from '../../lib/index.js';

import fileDrop from 'file-drops-safary-compatible';
import fileOpen from 'file-open';

import download from 'downloadjs';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

import './app.css';

import diagram from './diagram.bpmn';

let fileName = 'diagram.bpmn';

const modeler = new Modeler({
  container: '#modeler',
  keyboard: {
    bindTo: document,
  },
});

const viewer = new Viewer({
  container: '#viewer',
});

const update = async () => {
  const { xml } = await modeler.saveXML({ format: true });

  const xmlWithLayout = await layoutProcess(xml);

  viewer
    .importXML(xmlWithLayout)
    .then(({ warnings }) => {
      if (warnings.length) {
        console.log(warnings);
      }

      const canvas = viewer.get('canvas');

      canvas.zoom('fit-viewport');
    })
    .catch((err) => {
      console.log(err);
    });
};

modeler.on([ 'import.done', 'elements.changed' ], update);

// helpers ////////////

function openDiagram(diagram) {
  return modeler.importXML(diagram)
    .then(({ warnings }) => {
      if (warnings.length) {
        console.warn(warnings);
      }

      modeler.get('canvas').zoom('fit-viewport');
    })
    .catch(err => {
      console.error(err);
    });
}

function openFile(files) {

  // files = [ { name, contents }, ... ]

  if (!files.length) {
    return;
  }

  fileName = files[0].name;

  openDiagram(files[0].contents);
}

function downloadDiagram(modeler) {
  return modeler.saveXML({ format: true }).then(
    ({ xml }) => download(xml, fileName, 'application/xml')
  );
}

document.body.addEventListener('dragover', fileDrop('Open BPMN diagram', openFile), false);

const openButton = document.querySelector('#file-open');

openButton.addEventListener('click', function() {
  return fileOpen().then(openFile);
});

document.body.addEventListener('keydown', function(event) {
  if (event.code === 'KeyS' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();

    downloadDiagram(modeler);
  }

  if (event.code === 'KeyO' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();

    fileOpen().then(openFile);
  }
});

document.querySelector('#download-modeler').addEventListener('click', () => downloadDiagram(modeler));
document.querySelector('#download-viewer').addEventListener('click', () => downloadDiagram(viewer));

openDiagram(diagram);