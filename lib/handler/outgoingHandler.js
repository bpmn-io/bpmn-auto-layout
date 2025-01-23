import { connectElements } from '../utils/layoutUtil.js';
import { is } from '../di/DiUtil.js';
import {findElementInTree, getOutgoingElements} from '../utils/elementUtils.js';


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
        // вот здесь привязаться к новой функции

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
        // fixCrossesAfterAddAfter(nextElement, visited, grid);
        fixCrossesAfterAddBelow(nextElement, element, visited, grid)
      }
      else {
        // сначала ставим, потом устраняем пересечения
        grid.addBelow(previousElement, nextElement);
        fixCrossesAfterAddBelow(nextElement, element, visited, grid)
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
// fixCrossesAfterAddBelow(nextElement, element, visited, grid)
function fixCrossesAfterAddBelow(element, previousElement, visited, grid) {
  const [ elementRow, elementCol ] = grid.find(element);
  const [ previousElementRow, previousElementCol ] = grid.find(previousElement);

  // получаем все вышестоящие элементы с previousElement включительно до element исключая
  const upperElements = [];
  grid.grid.forEach((row, rowIndex) => {
    // не идем выше исходного и ниже текущего
    if (rowIndex < previousElementRow || rowIndex >= elementRow) return;
    const upperElement = grid.get(rowIndex, elementCol);
    // возможно стоит добавить что они все слева
    if (upperElement) {
      upperElements.push(upperElement);
    }
  });

  if (upperElements.length > 0){
    upperElements.forEach(upperElement => {
      // получаем исходящие из upperElement
      const incoming = (upperElement.incoming || [])
          .map(out => out.sourceRef)
          .filter(el => el);

      // работаем по исходящим
      incoming.forEach(incomingElement => {
        const [ incomingElementRow, incomingElementCol ]  =  grid.find(incomingElement);
        const [ upperElementRow, upperElementCol ] = grid.find(upperElement);
        const [ curElRow, curElCol ] = grid.find(element);
        const [ baseElRow, baseElCol ] = grid.find(previousElement);

        // сразу нафиг
        if (previousElement === incomingElement) return;


        // проверяем только находящиеся в гриде
        if (Number.isInteger(incomingElementRow) && Number.isInteger(incomingElementCol)) {

          // пересечение - если incomingElement находится в нижней левой части плоскости
          if (incomingElementRow > baseElRow && incomingElementCol <= curElCol) {
            // добавляем строку после upperElementRow
            // поднимаем все после element наверх
            grid.createRowAndShift([ upperElementRow, upperElementCol ])
            grid.shiftRight([ upperElementRow, upperElementCol ], curElRow)
          }

        }

      })
    })

  }

  // добавляем условие для 'пятки'
  // fixCrossesAfterAddBelow(nextElement, element, visited, grid)
  // fixCrossesAfterAddBelow(element, previousElement, visited, grid)
  // возможно стоит шифтить на разницу
  const [ baseRow, baseCol ] = grid.find(previousElement);
  const [ nextNewRow, nextNewCol ] = grid.find(element);
  const candidate = grid.get(nextNewRow, nextNewCol - 1)
  if (candidate) {
    // пока костыльчик для закрытия тестов
    const candidateOutgoing = getOutgoingElements(candidate).filter(outgoingElement => !visited.has(outgoingElement))

    if (candidateOutgoing.length > 0){
      // шифтим вниз

    } else {
      grid.shiftRight ([ baseRow, baseCol ], nextNewRow)
    }


  }




}


/**
 * Фиксит будущие пересечения для случая когда несколько исходящих
 * Прогнозируем пересечение для addBelow
 * @param element - элемент по которому идет движух
 * @param previousElement - элемент уже размещенный
 * @param grid
 */
function fixShift (element, previousElement, grid) {
  const [elementRow, elementCol] = grid.find(element);
  const [previousElementRow, previousElementCol] = grid.find(previousElement);

  const upperElements = [];

  // Ищем элементы, которые будут пересекаться
  grid.grid.forEach((row, rowIndex) => {
    // не идем выше исходного и ниже текущего
    if (rowIndex <= elementRow || rowIndex > previousElementRow) return;
    const upperElement = grid.get(rowIndex, previousElementCol - 1 );
    // возможно стоит добавить что они все слева
    if (upperElement) {
      upperElements.push(upperElement);
    }
  });


  if (upperElements.length > 0){
    grid.grid.forEach((row, rowIndex) => {
      if (rowIndex < elementRow || rowIndex > previousElementRow) return;
      // возможно стоит "оквадратить" грид
      row.splice(elementCol - 1, 0, null)
    })
  }


}