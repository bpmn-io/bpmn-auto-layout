import { is } from '../di/DiUtil.js';

export default {
  'addToGrid': ({ element, grid, visited }) => {

    // никогда не используется
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

        // где-то здесь надо вкорячить проверку чтобы Gateway_123l4g0 не улетал вправо
        if ((isNextElementExclusiveGateway(incoming) && is(element, 'bpmn:ExclusiveGateway'))) {

          // move ExclusiveGateway under the next column of the left element
          if (!grid.get(row, lowestCol + 1)) {
            grid.add(element, [ row, lowestCol + 1 ]);
            grid.removeElementAt([ row, col ]);
          }
        } else {

          // Вкорячиваем костыль чтобы смещение происходило если нет BoundaryEvent
          if (!incoming.some(item => is(item, 'bpmn:BoundaryEvent'))) {
            grid.adjustRowForMultipleIncoming(incoming, element);
          }
        }
      }

      // делаем свой алгоритм рядышком потом надо перенести
      // Пока рассматриваем случай когда исходящая ниже и левей базовой
      incoming.forEach(incomingElement => {
        let [ incomingElementRow, incomingElementCol ] = grid.find(incomingElement);
        let [ elementRow, elementCol ] = grid.find(element);

        // не рассматриваем варианты когда входящая выше или на линии элемента
        if (incomingElementRow <= elementRow) return;

        // не рассматриваем варианты когда входящая правее вертикали элемента
        if (incomingElementCol > elementCol) return;

        // входящий находится в нижнем левом секторе

        // проверяем горизонталь
        const horizontalCrossed = horizontalCrossedElementsForLeftDownCorner(element, incomingElement, grid);
        if (horizontalCrossed.length > 0) {

          // возможно elementCol +1 - надо пробовать
          grid.createRowAndShift([ incomingElementRow - 1, elementCol ], incomingElementCol);
        }

        // проверяем вертикаль
        const verticalCrossed = verticalCrossedElementsForLeftDownCorner(element, incomingElement, grid);
        if (verticalCrossed.length > 0) {

          // получаем максимальную строку
          const maxRow = verticalCrossed.reduce((acc, cur) => {
            let [ curRow ] = grid.find(cur);
            if (Number.isInteger(curRow) && !Number.isInteger(acc)) {
              return curRow;
            } else {
              if (curRow > acc) {
                return curRow;
              }
            }
          }, null);

          // шифтим вправо
          const [ elRow, elCol ] = grid.find(element);
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
  const [ incomingElementRow, incomingElementCol ] = grid.find(incomingElement);
  const [ _, elementCol ] = grid.find(element);

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
  const [ incomingElementRow ] = grid.find(incomingElement);
  const [ elementRow, elementCol ] = grid.find(element);

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
