import { connectElements } from '../utils/layoutUtil.js';
import { is } from '../di/DiUtil.js';
import { findElementInTree } from '../utils/elementUtils.js';


export default {
  'addToGrid': ({ element, grid, visited, stack }) => {
    let nextElements = [];

    // Handle outgoing paths
    const outgoing = (element.outgoing || [])
      .map(out => out.targetRef)
      .filter(el => el);

    let previousElement = null;

    // непонятно зачем только для task - попробовать дропнуть?
    if (outgoing.length > 1 && isNextElementTasks(outgoing)) {
      grid.adjustGridPosition(element);
    }

    outgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {

        // Здесь добавить проверку на пересечение и шифтить вправо
        let hasCross = false;
        const [ nextRow, nextCol ] = grid.find(nextElement);
        const [ curRow, curCol ] = grid.find(element);

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

      // Prevents revisiting future incoming elements and ensures proper traversal without early exit.
      if ((previousElement || stack.length > 0) && isFutureIncoming(nextElement, visited) && !checkForLoop(nextElement, visited)) {
        return;
      }

      if (!previousElement) {
        grid.addAfter(element, nextElement);
        fixCrossesAfterAddAfter(nextElement, visited, grid);
      }

      else if (is(element, 'bpmn:ExclusiveGateway') && is(nextElement, 'bpmn:ExclusiveGateway')) {
        grid.addBelow(previousElement, nextElement);
        fixCrossesAfterAddAfter(nextElement, visited, grid);
      }
      else {

        // проверяем есть ли на пересечении какой то элемент
        // если есть то шифтим вниз
        const [ newRow ] = grid.find(arr[index - 1]);
        const [ checkRow ,checkCol ] = grid.find(element);

        // добавляем если есть пересечение
        // позже добавить возможность смотреть по диапазону
        // определить newRow +1
        if (newRow + 1 !== checkRow && grid.get(newRow + 1, checkCol)) {
          grid.createRow(newRow);

          // все за checkCol поднимаем вверх на новую строку
          grid.grid.forEach((row,rowIndex) => {
            if (rowIndex > newRow + 1) {
              row.forEach((el, colIndex) => {
                if (colIndex < checkCol) {
                  const moovedEl = grid.get(rowIndex, colIndex);
                  grid.add(moovedEl, [ rowIndex - 1 , colIndex ]);
                  grid.grid[rowIndex][colIndex] = null;
                }
              });
            }
          });
        }
        grid.addBelow(arr[index - 1], nextElement);
      }

      // Is self-looping
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
  const nonMatching = arr.filter(item => !is(item,type));
  const matching = arr.filter(item => is(item,type));

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
  })



}