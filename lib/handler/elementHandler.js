import { is } from '../di/DiUtil';
import { getBounds } from '../utils/layoutUtil';

export default {
  'createElementDi': ({ element, row, col, diFactory }) => {

    const bounds = getBounds(element, row, col);

    const options = {
      id: element.id + '_di'
    };

    if (is(element, 'bpmn:ExclusiveGateway')) {
      options.isMarkerVisible = true;
    }

    const shapeDi = diFactory.createDiShape(element, bounds, options);
    element.di = shapeDi;
    element.gridPosition = { row, col };

    return shapeDi;
  }
};