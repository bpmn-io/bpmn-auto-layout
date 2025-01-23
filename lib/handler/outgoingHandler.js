import { connectElements } from '../utils/layoutUtil.js';
import { is } from '../di/DiUtil.js';
import { findElementInTree, getOutgoingElements } from '../utils/elementUtils.js';

export default {
  'addToGrid': ({ element, grid, visited, stack }) => {
    let nextElements = [];

    // Handle outgoing paths
    const outgoing = (element.outgoing || [])
      .map(out => out.targetRef)
      .filter(el => el);

    let previousElement = null;

    if (outgoing.length > 1 && isNextElementTasks(outgoing)) {
      grid.adjustGridPosition(element);
    }

    outgoing.forEach(nextElement => {
      if (visited.has(nextElement)) {

        // Check for crossovers and shift right if necessary
        let hasCross = false;
        const [ nextRow, nextCol ] = grid.find(nextElement);
        const [ curRow ] = grid.find(element);

        grid.grid.forEach((row, rowIndex) => {
          if (!hasCross && rowIndex > nextRow && rowIndex < curRow) {
            if (grid.get(rowIndex, nextCol)) {
              hasCross = true;
            }
          }
        });

        if (hasCross) {
          grid.grid.forEach((row, rowIndex) => {
            if (rowIndex >= nextRow && rowIndex <= curRow) {
              if (rowIndex === nextRow) {
                row.splice(nextCol, 0, null);
              } else {
                row.splice(nextCol + 1, 0, null);
              }
            }
          });
        }

        return;
      }

      // Prevent revisiting future incoming elements and ensure proper traversal without early exit
      if ((previousElement || stack.length > 0) && isFutureIncoming(nextElement, visited) && !checkForLoop(nextElement, visited)) {
        return;
      }

      if (!previousElement) {
        grid.addAfter(element, nextElement);
        fixCrossesAfterAddAfter(nextElement, visited, grid);
      } else {
        grid.addBelow(previousElement, nextElement);
        fixCrossesAfterAddBelow(nextElement, element, visited, grid);
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

      const connectionDi = diFactory.createDiEdge(out, waypoints, {
        id: out.id + '_di'
      });

      return connectionDi;
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

function isFutureIncoming(element, visited) {
  if (element.incoming.length > 1) {
    for (const incomingElement of element.incoming) {
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

function fixCrossesAfterAddAfter(element, visited, grid) {
  const [ elementRow, elementCol ] = grid.find(element);
  const upperElements = [];

  grid.grid.forEach((row, rowIndex) => {
    if (rowIndex >= elementRow) return;
    const upperElement = grid.get(rowIndex, elementCol);
    if (upperElement) {
      const upperElementIncomings = (upperElement.incoming || [])
        .map(out => out.sourceRef)
        .filter(el => el);
      if (upperElementIncomings.some(incoming => {
        const [ incomingRow ] = grid.find(incoming);
        return visited.has(incoming) && incomingRow > elementRow;
      })) {
        upperElements.push(upperElement);
      }
    }
  });

  upperElements.forEach(upperElement => {
    const [ upperElementRow, upperElementCol ] = grid.find(upperElement);
    grid.grid[upperElementRow].splice(upperElementCol, 0, null);
  });
}

function fixCrossesAfterAddBelow(element, previousElement, visited, grid) {
  const [ elementRow, elementCol ] = grid.find(element);
  const [ previousElementRow ] = grid.find(previousElement);

  // Get all upper elements between previousElement and element
  const upperElements = [];
  grid.grid.forEach((row, rowIndex) => {
    if (rowIndex < previousElementRow || rowIndex >= elementRow) return;
    const upperElement = grid.get(rowIndex, elementCol);
    if (upperElement) {
      upperElements.push(upperElement);
    }
  });

  if (upperElements.length > 0) {
    upperElements.forEach(upperElement => {
      const incoming = (upperElement.incoming || [])
        .map(out => out.sourceRef)
        .filter(el => el);

      incoming.forEach(incomingElement => {
        const [ incomingElementRow, incomingElementCol ] = grid.find(incomingElement);
        const [ upperElementRow, upperElementCol ] = grid.find(upperElement);
        const [ curElRow, curElCol ] = grid.find(element);
        const [ baseElRow ] = grid.find(previousElement);

        if (previousElement === incomingElement) return;

        if (Number.isInteger(incomingElementRow) && Number.isInteger(incomingElementCol)) {
          if (incomingElementRow > baseElRow && incomingElementCol <= curElCol) {
            grid.createRowAndShift([ upperElementRow, upperElementCol ]);
            grid.shiftRight([ upperElementRow, upperElementCol ], curElRow);
          }
        }
      });
    });
  }

  // Handle special case for multiple incoming sequenceFlows
  const [ baseRow, baseCol ] = grid.find(previousElement);
  const [ nextNewRow, nextNewCol ] = grid.find(element);
  const candidate = grid.get(nextNewRow, nextNewCol - 1);
  if (candidate) {
    const candidateOutgoing = getOutgoingElements(candidate).filter(outgoingElement => !visited.has(outgoingElement));

    if (candidateOutgoing.length > 0) {

      // Shift down
    } else {
      grid.shiftRight([ baseRow, baseCol ], nextNewRow);
    }
  }
}