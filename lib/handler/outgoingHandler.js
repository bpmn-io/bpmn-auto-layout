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
            // if (rowIndex >= nextRow && rowIndex <= curRow) {
              if (rowIndex === nextRow) {
                row.splice(nextCol + 1, 0, null);
              } else {
                row.splice(nextCol, 0, null);
              }
            // }
          });
        }
        // здесь ошибка при реверсе, но надо проверить и в обычном
        // if (reverse && previousElement !== nextElement) {
          previousElement = nextElement
        // }
        return;
      }

      // Prevent revisiting future incoming elements and ensure proper traversal without early exit
      // Граф рвется здесь isFutureIncoming если есть висящие в воздухе стартовые throwEvents
      // Пока оставляю как есть
      if ((previousElement || stack.length > 0) && isFutureIncoming(nextElement, visited, reverse) && !checkForLoop(nextElement, visited)) {
        return;
      }

      // Добавляем костыльчик


      if (!previousElement) {
        addAfter(element, nextElement, grid)
      } else {
        // Добавляем костыльчик!!!!
        const [prevRow, prevCol] = grid.find(previousElement);
        const [elRow, elCol] = grid.find(element);
        if (prevCol <= elCol) {
          addAfter(element, nextElement, grid)
        }

        else {
          // grid.addBelow(previousElement, nextElement);
          // здесь что-то не так
          addBelow(element, previousElement, nextElement, grid)
          // fixCrossesAfterAddBelow(nextElement, element, visited, grid, reverse);
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

// добавить reverse
// fixCrossesAfterAddBelow(nextElement, element, visited, grid, reverse);
function fixCrossesAfterAddBelow(element, previousElement, visited, grid, reverse) {
  const [ elementRow, elementCol ] = grid.find(element) || [];
  const [ previousElementRow ] = grid.find(previousElement) || [];

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
      const els = !reverse ? getIncomingElements(upperElement) : getOutgoingElements(upperElement)
      const incoming = els.map(out => out.sourceRef).filter(el => el);

      incoming.forEach(incomingElement => {
        const [ incomingElementRow, incomingElementCol ] = grid.find(incomingElement) || [];
        const [ upperElementRow, upperElementCol ] = grid.find(upperElement) || [];
        const [ curElRow, curElCol ] = grid.find(element) || [];
        const [ baseElRow ] = grid.find(previousElement) || [];

        if (previousElement === incomingElement) return;

        if (Number.isInteger(incomingElementRow) && Number.isInteger(incomingElementCol)) {
          if (incomingElementRow > baseElRow && incomingElementCol <= curElCol) {
            grid.createRowAndShift([ upperElementRow, upperElementCol ]);
            grid.shiftRight([ upperElementRow, upperElementCol ], curElRow);
            // проверка костыля
            // grid.expandXAxisWith([ curElRow, curElCol -1 ], true)
          }
        }
      });
    });
  }

  // Handle special case for multiple incoming sequenceFlows
  const [ baseRow, baseCol ] = grid.find(previousElement) || [];
  const [ nextNewRow, nextNewCol ] = grid.find(element) || [];
  const candidate = grid.get(nextNewRow, nextNewCol - 1);
  if (candidate) {
    const els = !reverse ? getOutgoingElements(candidate) : getIncomingElements(candidate)
    const candidateOutgoing = els.filter(outgoingElement => !visited.has(outgoingElement));

    if (candidateOutgoing.length > 0) {

      // Shift down
    } else {
      grid.shiftRight([ baseRow, baseCol ], nextNewRow);
    }
  }
}

export function addAfter(element, nextElement, grid) {
  const [elementRow, elementCol] = grid.find(element) || [];

  const occupiedElement = grid.get(elementRow, elementCol + 1);

  if (occupiedElement) {
    grid.expandXAxisWith([elementRow, elementCol])
  }
  grid.grid[elementRow][elementCol + 1] = nextElement

  // Crossover fix
  const onTopElements = grid.getAbove([elementRow, elementCol + 1])
  const incomingAndOutgoingElements = onTopElements.reduce((acc, cur) => {

    const adjacentElements = getAdjacentElements(cur).filter(el => grid.find(el))
    for (const adjacentElement of adjacentElements) {
      const [adjacentElementRow, adjacentElementCol] = grid.find(adjacentElement) || [];
      if (adjacentElementRow >= elementRow ){
        acc.add(adjacentElement)
      }
    }
    return acc
  }, new Set())


  const [nextPosRow, nextPosCol] = grid.find(nextElement) || [];
  if (incomingAndOutgoingElements.size > 0) {
    // grid.expandXAxisWith([elementRow, elementCol + 1], true)
    // здесь неправильное условие
    // grid.expandXAxisWith([elementRow, elementCol + 1], true)
    // grid.expandXAxisWith([elementRow, elementCol], true)
    // grid.expandXAxisWith(nextPos, true)


    // пока вручную для прямого перехода
    grid.grid.forEach((r,rIndex) => {
      if (rIndex === nextPosRow) {
        r.splice(nextPosCol + 1, 0, null)
      } else {
        r.splice(nextPosCol, 0, null)
      }
    })

  }

}

export function addBelow(element, previousElement, nextElement, grid) {
  const [previousElementRow, previousElementCol] = grid.find(previousElement) || [];
  const occupiedElement = grid.get(previousElementRow + 1, previousElementCol);
  if (occupiedElement || grid.grid.length === previousElementRow + 1) {
    grid.createRow(previousElementRow)
  }
  grid.grid[previousElementRow + 1][previousElementCol] = nextElement

  //устраняем пересечения после размещения
  // Попадает ли новый элемент в вертикальные пересечения предыдущего элемента
  // если попадает, то шифтим обходя предыдущий // выше не смотрим, так как уже проверено
  const crossed = new Set()
  getAdjacentElements(previousElement).filter(adjacentElement => {
    const [adjacentElementRow, adjacentElementCol] = grid.find(adjacentElement) || [];
    return previousElementRow <= adjacentElementRow
  }).forEach(filteredAdjacentElement => {
    // получаем пересекающиеся для filteredAdjacentElement - previousElement
    const crossedVertically = getElementsCrossedVertically (filteredAdjacentElement, previousElement, grid);
    if (crossedVertically) {
      crossedVertically.crossed.forEach((crossedElement) => {
        if (crossedElement === nextElement){
          crossed.add(crossedElement)
        }
      })
    }

  })
  const xElements = getElementsCrossedVertically(element, nextElement, grid)


  // if (crossed.size > 0){
  //   grid.expandXAxisWith([previousElementRow, previousElementCol], true)
  // }

  if (crossed.size > 0 && xElements.crossed.length > 0){
    const [nextRow, nextCol] = grid.find(nextElement) || [];
    grid.createRowAndShift([nextRow - 1, nextCol])
    // grid.expandXAxisWith([previousElementRow, previousElementCol], true)
    grid.grid.forEach((row, rowIndex) => {
      if (rowIndex === nextRow) {
        row.splice(nextCol + 1, 0, null)
      }else {
        row.splice(nextCol, 0, null)
      }
    })
  }

  // здесь обработка "ПЯТКИ"

  else if (xElements.crossed.length > 0) {
    // здесь нужен случай когда nextElement на вертикальном пересечении  или что-то иное чтобы раздвинуть вниз и вправо(огибая previousElement)

    // костыль есть ли исходящие, если есть то опускаем вниз
    // если есть пересекаемый элемент, который расположен на одной строке со следующим
    // и у него есть исходящие в неразмещенные, то добавляем строку
    // вверх поднимаем все кто после next + ее

    const [nRow, nCol] = grid.find(nextElement)
    const xOut = xElements.crossed.filter(xEl => {
      const [xElRow, xElCol] = grid.find(xEl) || [];
      const sameRow = xElRow === nRow
      const minusOneCol = xElCol === nCol - 1
      // отсутствующие в гриде
      const xElOutgoings = getOutgoingElements(xEl).filter(item => {
        const pos = grid.find(item)
        if (!pos) {
          return true
        }
      })


      return (sameRow && minusOneCol && xElOutgoings.length > 0)
    })

    if (xOut.length > 0) {
      grid.createRowAndShift([nRow -1])
    } else {
      // раздвигаем в обход верхнего элемента
      const topPosition = grid.find(xElements.topElement)

      grid.expandXAxisWith(topPosition, true)
    }


  }

  // // 1. "пятка"
  // const crossedElements = getElementsCrossedVertically(element, nextElement, grid)


}

function getElementsCrossedVertically (firstElement, secondElement, grid) {
  const firstElementPosition = grid.find(firstElement)
  if (!firstElementPosition) return;
  const secondElementPosition = grid.find(secondElement)
  if (!secondElementPosition) return;

  const [firstElementRow, firstElementCol] = firstElementPosition
  const [secondElementRow, secondElementCol] = secondElementPosition

  if (firstElementRow === secondElementRow || firstElementCol === secondElementCol) return;

  // определяем расположение элементов
  const topElement = firstElementRow < secondElementRow ? firstElement : secondElement
  const bottomElement = firstElementRow < secondElementRow ? secondElement : firstElement

  const [bottomElementRow, bottomElementCol] = grid.find(bottomElement)
  const [topElementRow, topElementCol] = grid.find(topElement)

  // получаем пересечения
  const crossed = new Set()
  // пересечения между topElementRow и bottomElementRow включая последний
  for (let i = topElementRow + 1; i <= bottomElementRow; i++) {
    const candidate = grid.get(i, topElementCol)
    if (candidate) crossed.add(candidate)
  }

  return {topElement, crossed: [...crossed] }
}