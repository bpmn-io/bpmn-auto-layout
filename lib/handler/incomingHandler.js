import { is } from '../di/DiUtil.js';

export default {
  'addToGrid': ({ element, grid, visited }) => {
    const nextElements = [];

    const incoming = (element.incoming || [])
      .map(out => out.sourceRef)
      .filter(el => el);

    // adjust the row if it is empty
    if (incoming.length > 1) {
      grid.adjustColumnForMultipleIncoming(incoming, element);

      const lowestRow = grid.getLowestRow(incoming);
      const lowestCol = grid.getLowestCol(incoming);
      const [ row , col ] = grid.find(element);

      if (lowestRow < row && !grid.get(lowestRow, col)) {
        if ((isNextElementExclusiveGateway(incoming) && is(element, 'bpmn:ExclusiveGateway'))) {

          // move ExclusiveGateway under the next column of the left element
          if (!grid.get(row, lowestCol + 1)) {
            grid.add(element, [ row, lowestCol + 1 ]);
            grid.removeElementAt([ row, col ]);
          }
        } else {
          grid.adjustRowForMultipleIncoming(incoming, element);
        }
      }
      grid.shrink();
    }
    return nextElements;
  },
};

function isNextElementExclusiveGateway(elements) {
  return elements.every(element => is(element, 'bpmn:ExclusiveGateway'));
}