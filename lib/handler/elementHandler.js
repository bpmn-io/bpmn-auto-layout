import { getBounds } from '../utils/layoutUtil';

export default {
  'createDi': ({ element, row, col, diFactory }) => {

    const bounds = getBounds(element, row, col);

    const shapeDi = diFactory.createDiShape(element, bounds, {
      id: element.id + '_di'
    });
    element.di = shapeDi;
    element.gridPosition = { row, col };

    return shapeDi;
  }
};