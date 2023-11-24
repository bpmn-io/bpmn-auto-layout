import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';

import { layoutProcess } from '../../lib/index';

import diagrams from '../diagrams';

diagrams.forEach(async xml => {
  const laidoutXML = await layoutProcess(xml);

  const parent = document.createElement('div');

  parent.classList.add('parent');

  document.body.appendChild(parent);

  const container = document.createElement('div');

  container.classList.add('container');

  parent.appendChild(container);

  const viewer = new NavigatedViewer({
    container: container,
    zoomScroll: {
      enabled: false
    }
  });

  viewer.importXML(xml).then(() => viewer.get('canvas').zoom('fit-viewport'));

  const laidoutContainer = document.createElement('div');

  laidoutContainer.classList.add('container', 'laidout');

  parent.appendChild(laidoutContainer);

  const laidoutViewer = new NavigatedViewer({
    container: laidoutContainer,
    zoomScroll: {
      enabled: false
    }
  });

  laidoutViewer.importXML(laidoutXML).then(() => laidoutViewer.get('canvas').zoom('fit-viewport'));
});