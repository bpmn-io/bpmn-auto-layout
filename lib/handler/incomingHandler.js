import { is } from '../di/DiUtil.js';
import { getIncomingElements, getOutgoingElements } from '../utils/elementUtils.js';
import { addAfter } from './outgoingHandler.js';

export default {
  'addToGrid': ({ element, grid, visited, reverse }) => {

    // never used
    const nextElements = [];

    const incoming = !reverse ? getIncomingElements(element) : getOutgoingElements(element);

    // handle insertion after break case
    // for now it's just like this, unsystematically - later we'll think about architecture :)
    const elementPosition = grid.find(element);
    const incomingInGrid = incoming.filter(el => {
      if (grid.find(el)) {
        return true;
      }
    });

    if (!elementPosition && incomingInGrid.length === 1) {
      addAfter(incoming[0], element, grid);
      visited.add(element);
    } else if (!elementPosition && incomingInGrid.length > 1) {

      // get the right bottom one... while there are no other ideas, we need to try
      const sourceElement = incoming.reduce((acc, cur) => {
        const [ accRow, accCol ] = acc;
        const [ curRow, curCol ] = cur;
        if (curRow >= accRow && accCol <= curCol) return cur;
        return acc;
      }, incoming[0]);

      // For now, we just insert without checking intersections - I don't think this is a common case
      addAfter(sourceElement, element, grid);
      visited.add(element);
    } else if (!elementPosition && incomingInGrid.length === 0) {
      grid.add(element);
      visited.add(element);
    } else if (incoming.length > 1) {
      grid.adjustColumnForMultipleIncoming(incoming, element);
      const lowestRow = grid.getLowestRow(incoming);
      const lowestCol = grid.getLowestCol(incoming);
      const [ row , col ] = grid.find(element) || [];

      if (lowestRow < row && !grid.get(lowestRow, col)) {

        if ((isNextElementExclusiveGateway(incoming) && is(element, 'bpmn:ExclusiveGateway'))) {

          // move ExclusiveGateway under the next column of the left element
          if (!grid.get(row, lowestCol + 1)) {
            grid.add(element, [ row, lowestCol + 1 ]);
            grid.removeElementAt([ row, col ]);
          }
        } else {

          // offset occurs if there is no BoundaryEvent
          if (!incoming.some(item => is(item, 'bpmn:BoundaryEvent'))) {

            // if the far right has another outgoing one that is not yet in the grid, then we do not do the offset
            const rightElement = incoming.reduce((acc, cur) => {
              const [ accRow, accCol ] = grid.find(acc);
              const [ curRow, curCol ] = grid.find(cur);
              if (curRow >= accRow && curCol >= accCol) {
                return cur;
              }
              return acc;
            }, incoming[0]);

            // open question about boundary
            const rightElementOutgoing = !grid.isFlipped ? getOutgoingElements(rightElement) : getIncomingElements(rightElement);

            const rightElementOutgoingOutOfGrid = rightElementOutgoing.filter(item => {
              return (!grid.find(item) && item !== rightElement && item !== element);
            });

            if (rightElementOutgoingOutOfGrid.length === 0) {
              grid.adjustRowForMultipleIncoming(incoming, element);
            }
          }
        }
      }

      // make another algorithm near old. Need refactoring
      // case when the element is located below and to the left
      incoming.forEach(incomingElement => {
        let [ incomingElementRow, incomingElementCol ] = grid.find(incomingElement) || [];
        let [ elementRow, elementCol ] = grid.find(element) || [];

        // we do not consider options when the incoming is above or on the element line
        if (incomingElementRow <= elementRow) return;

        // not consider options when the incoming element is to the right of the vertical element
        if (incomingElementCol > elementCol) return;

        // incoming element is in the lower left sector
        // check the horizontal
        const horizontalCrossed = horizontalCrossedElementsForLeftDownCorner(element, incomingElement, grid);
        if (horizontalCrossed.length > 0) {

          grid.createRowAndShift([ incomingElementRow - 1, elementCol ], incomingElementCol);
        }

        // check the vertical
        const verticalCrossed = verticalCrossedElementsForLeftDownCorner(element, incomingElement, grid);
        if (verticalCrossed.length > 0) {

          // get the maximum row
          const maxRow = verticalCrossed.reduce((acc, cur) => {
            let [ curRow ] = grid.find(cur) || [];
            if (Number.isInteger(curRow) && !Number.isInteger(acc)) {
              return curRow;
            } else {
              if (curRow > acc) {
                return curRow;
              }
            }
          }, null);

          // shift right
          const [ elRow, elCol ] = grid.find(element) || [];
          grid.shiftRight ([ elRow, elCol ], maxRow);
        }
      });

      grid.shrinkRows();
    }
    return nextElements;
  },
};

function isNextElementExclusiveGateway(elements) {
  return elements.every(element => is(element, 'bpmn:ExclusiveGateway'));
}

function horizontalCrossedElementsForLeftDownCorner(element, incomingElement, grid) {
  const crossedElements = [];
  const [ incomingElementRow, incomingElementCol ] = grid.find(incomingElement) || [];
  const [ _, elementCol ] = grid.find(element) || [];

  grid.grid.forEach((row, rowIndex) => {
    if (rowIndex !== incomingElementRow) return;
    row.forEach((gridItem, colIndex) => {
      if (colIndex < incomingElementCol || colIndex > elementCol) return;
      const candidateElement = grid.get(rowIndex, colIndex);
      if (candidateElement === incomingElement) return;
      if (candidateElement) {
        crossedElements.push(candidateElement);
      }
    });
  });

  return crossedElements;
}

function verticalCrossedElementsForLeftDownCorner(element, incomingElement, grid) {
  const crossedElements = [];
  const [ incomingElementRow ] = grid.find(incomingElement) || [];
  const [ elementRow, elementCol ] = grid.find(element) || [];

  grid.grid.forEach((row, rowIndex) => {
    if (rowIndex < elementRow || rowIndex > incomingElementRow) return;
    row.forEach((gridItem, colIndex) => {
      if (colIndex !== elementCol) return;
      const candidateElement = grid.get(rowIndex, colIndex);
      if (candidateElement === element) return;
      if (candidateElement) {
        crossedElements.push(candidateElement);
      }
    });
  });

  return crossedElements;
}
