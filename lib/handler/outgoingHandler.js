import { connectElements } from '../utils/layoutUtil.js';
import { is } from '../di/DiUtil.js';
import {
  findElementInTree,
  getAdjacentElements,
  getIncomingElements,
  getOutgoingElements
} from '../utils/elementUtils.js';

export default {
  'addToGrid': ({ element, grid, visited, stack, reverse }) => {
    let nextElements = [];

    // Handle outgoing paths
    const outgoing = !reverse ? getOutgoingElements(element) : getIncomingElements(element);

    let previousElement = null;

    if (outgoing.length > 1 && isNextElementTasks(outgoing)) {
      grid.adjustGridPosition(element);
    }

    outgoing.forEach(nextElement => {
      if (visited.has(nextElement)) {

        // Check for crossovers and shift right if necessary
        let hasCross = false;
        const [ nextRow, nextCol ] = grid.find(nextElement) || [];
        const [ curRow ] = grid.find(element) || [];

        grid.grid.forEach((row, rowIndex) => {
          if (!hasCross && rowIndex > nextRow && rowIndex <= curRow) {
            if (grid.get(rowIndex, nextCol)) {
              hasCross = true;
            }
          }
        });

        if (hasCross) {
          grid.grid.forEach((row, rowIndex) => {
            if (rowIndex === nextRow) {
              row.splice(nextCol + 1, 0, null);
            } else {
              row.splice(nextCol, 0, null);
            }
          });
        }
        previousElement = nextElement;
        return;
      }

      // Prevent revisiting future incoming elements and ensure proper traversal without early exit
      // The graph breaks here in isFutureIncoming if there are starting throwEvents hanging in the air
      // need refactoring
      if ((previousElement || stack.length > 0) && isFutureIncoming(nextElement, visited, reverse) && !checkForLoop(nextElement, visited)) {
        return;
      }

      if (!previousElement) {
        addAfter(element, nextElement, grid);
      } else {
        const [ , prevCol ] = grid.find(previousElement);
        const [ , elCol ] = grid.find(element);
        if (prevCol <= elCol) {
          addAfter(element, nextElement, grid);
        }

        else {
          addBelow(element, previousElement, nextElement, grid);
        }
      }

      // Avoid self-loops
      if (nextElement !== element) {
        previousElement = nextElement;
      }

      nextElements.unshift(nextElement);
      visited.add(nextElement);
    });

    // Sort elements by priority to ensure proper stack placement
    nextElements = sortByType(nextElements, 'bpmn:ExclusiveGateway'); // TODO: sort by priority
    return nextElements;
  },

  'createConnectionDi': ({ element, row, col, layoutGrid, diFactory }) => {
    const outgoing = element.outgoing || [];

    return outgoing.map(out => {
      const target = out.targetRef;
      const waypoints = connectElements(element, target, layoutGrid);

      return diFactory.createDiEdge(out, waypoints, {
        id: out.id + '_di'
      });
    });
  }
};


// helpers /////

function sortByType(arr, type) {
  const nonMatching = arr.filter(item => !is(item, type));
  const matching = arr.filter(item => is(item, type));

  return [ ...matching, ...nonMatching ];
}

function checkForLoop(element, visited) {
  for (const incomingElement of element.incoming) {
    if (!visited.has(incomingElement.sourceRef)) {
      return findElementInTree(element, incomingElement.sourceRef);
    }
  }
}

function isFutureIncoming(element, visited, reverse) {
  const els = !reverse ? element.incoming : element.outgoing;

  if (els.length > 1) {
    for (const incomingElement of els) {
      if (!visited.has(incomingElement.sourceRef)) {
        return true;
      }
    }
  }
  return false;
}

function isNextElementTasks(elements) {
  return elements.every(element => is(element, 'bpmn:Task'));
}

export function addAfter(element, nextElement, grid) {
  const [ elementRow, elementCol ] = grid.find(element) || [];

  const occupiedElement = grid.get(elementRow, elementCol + 1);

  if (occupiedElement) {
    grid.expandXAxisWith([ elementRow, elementCol ]);
  }
  grid.grid[elementRow][elementCol + 1] = nextElement;

  // Crossover fix
  const onTopElements = grid.getAbove([ elementRow, elementCol + 1 ]);
  const incomingAndOutgoingElements = onTopElements.reduce((acc, cur) => {

    const adjacentElements = getAdjacentElements(cur).filter(el => grid.find(el));
    for (const adjacentElement of adjacentElements) {
      const [ adjacentElementRow ] = grid.find(adjacentElement) || [];
      if (adjacentElementRow >= elementRow) {
        acc.add(adjacentElement);
      }
    }
    return acc;
  }, new Set());


  const [ nextPosRow, nextPosCol ] = grid.find(nextElement) || [];
  if (incomingAndOutgoingElements.size > 0) {

    grid.grid.forEach((r,rIndex) => {
      if (rIndex === nextPosRow) {
        r.splice(nextPosCol + 1, 0, null);
      } else {
        r.splice(nextPosCol, 0, null);
      }
    });
  }
}

export function addBelow(element, previousElement, nextElement, grid) {
  const [ previousElementRow, previousElementCol ] = grid.find(previousElement) || [];
  const occupiedElement = grid.get(previousElementRow + 1, previousElementCol);
  if (occupiedElement || grid.grid.length === previousElementRow + 1) {
    grid.createRow(previousElementRow);
  }
  grid.grid[previousElementRow + 1][previousElementCol] = nextElement;

  // eliminate intersections after placement
  // Does the new element fall within the vertical intersections of the previous element?
  // don't look higher up the grid, as it has already been checked
  const crossed = new Set();
  getAdjacentElements(previousElement).filter(adjacentElement => {
    const [ adjacentElementRow ] = grid.find(adjacentElement) || [];
    return previousElementRow <= adjacentElementRow;
  }).forEach(filteredAdjacentElement => {

    // get intersecting for filteredAdjacentElement - previousElement
    const crossedVertically = getElementsCrossedVertically (filteredAdjacentElement, previousElement, grid);
    if (crossedVertically) {
      crossedVertically.crossed.forEach((crossedElement) => {
        if (crossedElement === nextElement) {
          crossed.add(crossedElement);
        }
      });
    }
  });

  const xElements = getElementsCrossedVertically(element, nextElement, grid);

  if (crossed.size > 0 && xElements.crossed.length > 0) {
    const [ nextRow, nextCol ] = grid.find(nextElement) || [];
    grid.createRowAndShift([ nextRow - 1, nextCol ]);
    grid.grid.forEach((row, rowIndex) => {
      if (rowIndex === nextRow) {
        row.splice(nextCol + 1, 0, null);
      } else {
        row.splice(nextCol, 0, null);
      }
    });
  }

  // for corner edges
  else if (xElements.crossed.length > 0) {

    // if there are outgoing ones, then we move it down
    // if there is an intersected element that is on the same line as the next one,
    // and he has outgoing in unplaced, then we add a line
    // raise up everyone if it after next  (also next)
    const [ nRow, nCol ] = grid.find(nextElement);
    const xOut = xElements.crossed.filter(xEl => {
      const [ xElRow, xElCol ] = grid.find(xEl) || [];
      const sameRow = xElRow === nRow;
      const minusOneCol = xElCol === nCol - 1;

      // not in grid
      const xElOutgoings = getOutgoingElements(xEl).filter(item => {
        const pos = grid.find(item);
        if (!pos) {
          return true;
        }
      });

      return (sameRow && minusOneCol && xElOutgoings.length > 0);
    });

    if (xOut.length > 0) {
      grid.createRowAndShift([ nRow - 1 ]);
    } else {

      // shift around the top element
      const topPosition = grid.find(xElements.topElement);

      grid.expandXAxisWith(topPosition, true);
    }
  }
}

function getElementsCrossedVertically(firstElement, secondElement, grid) {
  const firstElementPosition = grid.find(firstElement);
  if (!firstElementPosition) return;
  const secondElementPosition = grid.find(secondElement);
  if (!secondElementPosition) return;

  const [ firstElementRow, firstElementCol ] = firstElementPosition;
  const [ secondElementRow, secondElementCol ] = secondElementPosition;

  if (firstElementRow === secondElementRow || firstElementCol === secondElementCol) return;

  // get location of the elements
  const topElement = firstElementRow < secondElementRow ? firstElement : secondElement;
  const bottomElement = firstElementRow < secondElementRow ? secondElement : firstElement;

  const [ bottomElementRow ] = grid.find(bottomElement);
  const [ topElementRow, topElementCol ] = grid.find(topElement);

  // get intersections
  const crossed = new Set();

  // intersections between topElementRow and bottomElementRow including the latter
  for (let i = topElementRow + 1; i <= bottomElementRow; i++) {
    const candidate = grid.get(i, topElementCol);
    if (candidate) crossed.add(candidate);
  }

  return { topElement, crossed: [ ...crossed ] };
}