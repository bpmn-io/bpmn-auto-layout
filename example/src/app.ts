import Viewer from 'bpmn-js/lib/NavigatedViewer.js';
import Modeler from 'bpmn-js/lib/Modeler.js';

import { layoutProcess } from '../../dist/index.js';

import fileDrop from 'file-drops';
import type { DropFn } from 'file-drops';
import fileOpen from 'file-open';

import download from 'downloadjs';
import type Canvas from 'diagram-js/lib/core/Canvas.js';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

import './app.css';

import diagram from './diagram.bpmn';

let fileName = 'diagram.bpmn';

const modeler = new Modeler({
  container: '#modeler',
});

const viewer = new Viewer({
  container: '#viewer',
});

const update = async (): Promise<void> => {
  const { xml } = await modeler.saveXML({ format: true });

  if (xml === undefined) {
    throw new Error('Unable to save the modeler diagram.');
  }

  const {
    xml: xmlWithLayout,
    warnings: layoutWarnings
  } = await layoutProcess(xml);

  if (layoutWarnings.length) {
    console.warn(layoutWarnings);
  }

  viewer
    .importXML(xmlWithLayout)
    .then(({ warnings }) => {
      if (warnings.length) {
        console.log(warnings);
      }

      const canvas = viewer.get<Canvas>('canvas');

      canvas.zoom('fit-viewport');
    })
    .catch((err) => {
      console.log(err);
    });
};

modeler.on([ 'import.done', 'elements.changed' ], update);

// helpers ////////////

function openDiagram(diagram: string): Promise<void> {
  return modeler.importXML(diagram)
    .then(({ warnings }) => {
      if (warnings.length) {
        console.warn(warnings);
      }

      modeler.get<Canvas>('canvas').zoom('fit-viewport');
    })
    .catch(err => {
      console.error(err);
    });
}

function openFile(files: Parameters<DropFn>[0]): void {

  // files = [ { name, contents }, ... ]

  const [ file ] = files;

  if (!file) {
    return;
  }

  fileName = file.name;

  void openDiagram(file.contents);
}

function downloadDiagram(diagram: Modeler | Viewer): Promise<boolean | XMLHttpRequest> {
  return diagram.saveXML({ format: true }).then(({ xml }) => {
    if (xml === undefined) {
      throw new Error('Unable to save the diagram.');
    }

    return download(xml, fileName, 'application/xml');
  });
}

document.body.addEventListener('dragover', fileDrop('Open BPMN diagram', openFile), false);

const openButton = document.querySelector<HTMLButtonElement>('#file-open');

if (!openButton) {
  throw new Error('Open button is missing.');
}

openButton.addEventListener('click', function() {
  return fileOpen({}).then(openFile);
});

document.body.addEventListener('keydown', function(event) {
  if (event.code === 'KeyS' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();

    downloadDiagram(modeler);
  }

  if (event.code === 'KeyO' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();

    fileOpen({}).then(openFile);
  }
});

const downloadModelerButton = document.querySelector<HTMLButtonElement>('#download-modeler');
const downloadViewerButton = document.querySelector<HTMLButtonElement>('#download-viewer');

if (!downloadModelerButton || !downloadViewerButton) {
  throw new Error('Download button is missing.');
}

downloadModelerButton.addEventListener('click', () => downloadDiagram(modeler));
downloadViewerButton.addEventListener('click', () => downloadDiagram(viewer));

void openDiagram(diagram);