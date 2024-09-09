import { is } from './di/DiUtil.js';

export class Grid {
  constructor() {
    this.grid = [];
  }

  add(element, position) {
    if (!position) {
      this._addStart(element);
      return;
    }

    const [ row, col ] = position;
    if (!row && !col) {
      this._addStart(element);
    }

    if (!this.grid[row]) {
      this.grid[row] = [];
    }

    if (this.grid[row][col]) {
      throw new Error('Grid is occupied please ensure the place you insert at is not occupied');
    }

    this.grid[row][col] = element;
  }

  createRow(afterIndex) {
    if (!afterIndex) {
      this.grid.push([]);
    }

    this.grid.splice(afterIndex + 1, 0, []);
  }

  _addStart(element) {
    this.grid.push([ element ]);
  }

  addAfter(element, newElement) {
    if (!element) {
      this._addStart(newElement);
    }
    const [ row, col ] = this.find(element);
    this.grid[row].splice(col + 1, 0, newElement);
  }

  addBelow(element, newElement) {
    if (!element) {
      this._addStart(newElement);
    }

    const [ row, col ] = this.find(element);

    // We are at the bottom of the current grid - add empty row below
    if (!this.grid[row + 1]) {
      this.grid[row + 1] = [];
    }

    // The element below is already occupied - insert new row
    if (this.grid[row + 1][col]) {
      this.grid.splice(row + 1, 0, []);
    }

    if (this.grid[row + 1][col]) {
      throw new Error('Grid is occupied and we could not find a place - this should not happen');
    }

    this.grid[row + 1][col] = newElement;
  }

  find(element) {
    let row, col;
    row = this.grid.findIndex((row) => {
      col = row.findIndex((el) => {
        return el === element;
      });

      return col !== -1;
    });

    return [ row, col ];
  }

  get(row, col) {
    return (this.grid[row] || [])[col];
  }

  getElementsInRange({ row: startRow, col: startCol }, { row: endRow, col: endCol }) {
    const elements = [];

    if (startRow > endRow) {
      [ startRow, endRow ] = [ endRow, startRow ];
    }

    if (startCol > endCol) {
      [ startCol, endCol ] = [ endCol, startCol ];
    }

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const element = this.get(row, col);

        if (element) {
          elements.push(element);
        }
      }
    }

    return elements;
  }

  adjustGridPosition(element) {
    let [ row, col ] = this.find(element);
    const [ , maxCol ] = this.getGridDimensions();

    if (col < maxCol) {

      // add element in next column
      this.grid[row].length = maxCol + 1;
      this.grid[row][maxCol] = element;
      this.grid[row][col] = null;

    }
  }

  adjustRowToStartEvent(element) {
    let [ row, ] = this.findStartEventCoordinates();
    let [ currentRow, currentCol ] = this.find(element);

    // if element doesn't already exist in current row, add element
    if (!this.grid[row][currentCol]) {
      this.grid[row][currentCol] = element;
      this.grid[currentRow][currentCol] = null;
    }
  }

  getGridDimensions() {
    const numRows = this.grid.length;
    let maxCols = 0;

    for (let i = 0; i < numRows; i++) {
      const currentRowLength = this.grid[i].length;
      if (currentRowLength > maxCols) {
        maxCols = currentRowLength;
      }
    }

    return [ numRows , maxCols ];
  }

  findStartEventCoordinates() {
    for (let row = 0; row < this.grid.length; row++) {
      for (let col = 0; col < this.grid[row].length; col++) {
        const element = this.grid[row][col];

        if (element && is(element,'bpmn:StartEvent')) {
          return [ row, col ];

        }
      }
    }
    return [ null,null ];
  }


  elementsByPosition() {
    const elements = [];

    this.grid.forEach((row, rowIndex) => {
      row.forEach((element, colIndex) => {
        if (!element) {
          return;
        }
        elements.push({
          element,
          row: rowIndex,
          col: colIndex
        });
      });
    });

    return elements;
  }
}


