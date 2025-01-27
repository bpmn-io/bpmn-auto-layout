export class Grid {
  constructor() {
    this.grid = [];
    this.isFlipped = false;
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
    if (!afterIndex && !Number.isInteger(afterIndex)) {
      this.grid.push([]);
    }

    this.grid.splice(afterIndex + 1, 0, []);
  }

  _addStart(element) {
    this.grid.push([ element ]);
  }

  /**
   * return position of element:
   * - [row: integer, col: integer] if element exist
   * - else undefined
   * @param element
   * @returns {number[] | undefined}
   */
  find(element) {
    let row, col;
    row = this.grid.findIndex((row) => {
      col = row.findIndex((el) => {
        return el === element;
      });
      return col !== -1;
    });

    if (Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0) {
      return [ row, col ];
    }
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
    let [ row, col ] = this.find(element) || [];
    const [ , maxCol ] = this.getGridDimensions();

    if (col < maxCol - 1) {

      // add element in next column
      this.grid[row].length = maxCol;
      this.grid[row][maxCol] = element;
      this.grid[row][col] = null;

    }
  }

  adjustRowForMultipleIncoming(elements, currentElement) {

    // filter only rows that currently exist, excluding any future or non-existent rows
    const lowestRow = this.getLowestRow(elements);

    const [ row , col ] = this.find(currentElement) || [];

    this.grid[lowestRow][col] = currentElement;
    this.grid[row][col] = null;
  }

  adjustColumnForMultipleIncoming(elements, currentElement) {
    const results = elements.map(element => this.find(element) || []);

    // filter only col that currently exist, excluding any future or non-existent col
    const maxCol = Math.max(...results
      .map(result => result[1])
      .filter(col => col >= 0));

    const [ row , col ] = this.find(currentElement) || [];

    // add to the next column
    if (maxCol + 1 > col) {
      this.grid[row][maxCol + 1] = currentElement;
      this.grid[row][col] = null;
    }
  }

  getAllElements() {
    const elements = [];

    for (let row = 0; row < this.grid.length; row++) {
      for (let col = 0; col < this.grid[row].length; col++) {
        const element = this.get(row, col);

        if (element) {
          elements.push(element);
        }
      }
    }

    return elements;
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

  // may be used later
  getElementsTotal() {
    const flattenedGrid = this.grid.flat();
    const uniqueElements = new Set(flattenedGrid.filter(value => value));
    return uniqueElements.size;
  }

  shrinkCols() {
    const [ rowCount, colCount ] = this.getGridDimensions();

    for (let iCol = colCount - 1; iCol >= 0; iCol--) {
      const rowsToShrink = [];
      this.grid.forEach((row, rowIndex) => {
        if (row[iCol] == null) rowsToShrink.push(rowIndex);
      });

      if (rowsToShrink.length === rowCount) {
        this.grid.forEach(row => {
          row.splice(iCol, 1);
        });
      }
    }
  }

  shrinkRows() {
    this.grid = this.grid.filter(row => !row.every(col => ((col == null))));
  }

  getLowestRow(elements) {
    const results = elements.map(element => this.find(element) || []);

    // filter only rows that currently exist, excluding any future or non-existent rows
    return Math.min(...results
      .map(result => result[0])
      .filter(row => row >= 0));
  }

  getLowestCol(elements) {
    const results = elements.map(element => this.find(element) || []);

    return Math.min(...results
      .map(result => result[1])
      .filter(col => col >= 0));
  }

  removeElementAt(position) {
    const [ row, col ] = position;
    this.grid[row][col] = null;
  }

  createRowAndShift(position, firstCol) {
    const [ positionRow, positionCol ] = position;

    this.createRow(positionRow);

    this.grid.forEach((row, rowIndex) => {
      if (rowIndex <= positionRow + 1) return;
      row.forEach((element, colIndex) => {

        // do not shift before firstCol
        if (colIndex >= positionCol || (Number.isInteger(firstCol) && colIndex !== firstCol)) {
          this.grid[rowIndex - 1][colIndex] = element;
          this.grid[rowIndex][colIndex] = null;
        }
      });
    });
  }

  shiftRight(position, lastRow) {
    const [ positionRow, positionCol ] = position;

    this.grid.forEach((row, rowIndex) => {
      if (rowIndex < positionRow || rowIndex > lastRow) return;
      if (rowIndex === lastRow) {
        row.splice(positionCol + 1, 0, null);
      } else {
        row.splice(positionCol, 0, null);
      }
    });

  }

  toRectangle() {
    const [ _, colCount ] = this.getGridDimensions();
    this.grid.forEach((row) => {
      if (row.length < colCount) {
        const difference = colCount - row.length;
        for (let i = 0; i < difference; i++) {
          row.splice(row.length, 0, null);
        }
      }
    });
  }

  flipHorizontally() {
    this.grid.forEach((row) => {
      row.reverse();
    });
    this.isFlipped = !this.isFlipped;
  }

  /**
   * ## Expand grid XAxis
   * Add new column after position if bypass is false for not flipped grid
   * - if isFlipped === false && bypass === true
   * ```
   * ..|..
   * .|x..
   * ..|..
   * ```
   * - if isFlipped === true && bypass === true
   * ```
   * .|...
   * .x|..
   * .|...
   * ```
   * row and col must be positive integer or 0
   * @param {[row: number, col: number]} position
   * @param {boolean=} bypass
   */
  expandXAxisWith(position, bypass) {
    const [ row, col ] = position;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return;
    this.grid.forEach((gridRow, rowIndex) => {
      if (!this.isFlipped) {
        if (bypass) {
          if (rowIndex === row) {
            gridRow.splice(col, 0, null);
          } else {
            gridRow.splice(col + 1, 0, null);
          }
        } else {
          gridRow.splice(col + 1, 0, null);
        }

      } else {
        if (bypass) {
          if (rowIndex === row) {
            gridRow.splice(col + 1, 0, null);
          } else {
            gridRow.splice(col, 0, null);
          }
        } else {
          gridRow.splice(col, 0, null);
        }
      }
    });
  }

  getAbove(position) {
    const [ row, col ] = position;
    const elements = [];
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return;
    for (let i = 0; i < row; i++) {
      const candidate = this.get(i, col);
      if (candidate) {
        elements.push(candidate);
      }
    }
    return elements;
  }

}