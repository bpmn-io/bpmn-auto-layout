import { is } from '../di/DiUtil.js';
import { getBounds } from '../utils/layoutUtil.js';

export default {
  'createElementDi': ({ element, row, col, diFactory, shift }) => {

    const bounds = getBounds(element, row, col, shift);

    const options = {
      id: element.id + '_di'
    };

    if (is(element, 'bpmn:ExclusiveGateway')) {
      options.isMarkerVisible = true;
    }

    if (element.isExpanded) {
      options.isExpanded = true;
    }

    const shapeDi = diFactory.createDiShape(element, bounds, options);
    element.di = shapeDi;
    element.gridPosition = { row, col };

    return shapeDi;
  }
};