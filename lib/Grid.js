export class Grid {
  constructor() {
    this.grid = [];
    this.highestRow = 0;
    this.highestColumn = 0;
  }

  updateHighest(position) {
    const [ row, col ] = position;

    if (row > this.highestRow) {
      this.highestRow = row;
    }
    if (col > this.highestColumn) {
      this.highestColumn = col;
    }
  }

  ensureRow(row) {
    if (row > this.highestRow) {
      for (let rowIndex = this.highestRow + 1; rowIndex <= row; rowIndex++) {
        this.grid[rowIndex] = [];
      }
    }
  }

  ensureColumn(col) {
    if (col < 0) {
      for (let colIndex = 0; colIndex < Math.abs(col); colIndex++) {
        for (let rowIndex = 0; rowIndex <= this.highestRow; rowIndex++) {
          this.grid[rowIndex].unshift(null);
        }
      }
      this.highestColumn += Math.abs(col);
      return Math.abs(col);
    }
    return 0;
  }

  checkPosition(position) {
    const [ row, col ] = position;
    if (this.grid[row][col]) {
      throw new Error('Grid is occupied and we could not find a place - this should not happen');
    }
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

    this.ensureRow(row);
    this.checkPosition(position);

    this.grid[row][col] = element;
    this.updateHighest(position);
  }

  createRow(afterIndex) {
    if (!afterIndex) {
      this.grid.push([]);
    }

    this.grid.splice(afterIndex + 1, 0, []);
  }

  _addStart(element) {
    this.grid.push([ element ]);
    this.highestRow = this.grid.length - 1;
  }

  addToNextEmptyRowAndColumn(position, newElement, rowOffset) {
    const [ row, col ] = position;
    let emptyRow = row + rowOffset;
    let emptyCol = col + 1;

    if (emptyCol <= this.highestColumn) {
      while (this.getElementsInRange({ row: emptyRow, col: emptyCol }, { row: emptyRow, col: this.highestColumn }).length !== 0) {
        emptyRow += 1;
      }
    }
    if (emptyRow <= this.highestRow) {
      while (this.getElementsInRange({ row: emptyRow, col: emptyCol }, { row: this.highestRow, col: emptyCol }).length !== 0) {
        emptyCol += 1;
      }
    }

    this.ensureRow(emptyRow);
    this.checkPosition([ emptyRow, emptyCol ]);

    this.grid[emptyRow][emptyCol] = newElement;
    this.updateHighest([ emptyRow, emptyCol ]);
  }

  addToNextEmptyRow(position, newElement, rowOffset) {
    const [ row, col ] = position;
    let emptyRow = row + rowOffset;

    if (col + 1 <= this.highestColumn) {
      while (this.getElementsInRange({ row: emptyRow, col: col + 1 }, { row: emptyRow, col: this.highestColumn }).length !== 0) {
        emptyRow += 1;
      }
    }

    this.ensureRow(emptyRow);
    this.checkPosition([ emptyRow, col + 1 ]);

    this.grid[emptyRow][col + 1] = newElement;
    this.updateHighest([ emptyRow, col + 1 ]);
  }


  addToPreviousEmptyColumn(position, newElement, rowOffset) {
    const [ row, col ] = position;
    let emptyCol = col - 1;

    if (row + rowOffset <= this.highestRow) {
      while (this.getElementsInRange({ row: row + rowOffset, col: emptyCol }, { row: this.highestRow, col: emptyCol }).length !== 0) {
        emptyCol -= 1;
      }
    }

    this.ensureRow(row + rowOffset);
    const columnOffset = this.ensureColumn(emptyCol);
    this.checkPosition([ row + rowOffset, emptyCol + columnOffset ]);

    this.grid[row + rowOffset][emptyCol + columnOffset] = newElement;
    this.updateHighest([ row + rowOffset, emptyCol + columnOffset ]);
  }

  addToPreviousEmptyRow(position, newElement, rowOffset) {
    const [ row, col ] = position;
    let emptyRow = row + rowOffset;

    if (col - 1 >= 0) {
      while (this.getElementsInRange({ row: emptyRow, col: col - 1 }, { row: emptyRow, col: 0 }).length !== 0) {
        emptyRow += 1;
      }
    }

    this.ensureRow(emptyRow);
    const columnOffset = this.ensureColumn(col - 1);
    this.checkPosition([ emptyRow, col - 1 + columnOffset ]);

    this.grid[emptyRow][col - 1 + columnOffset] = newElement;
    this.updateHighest([ emptyRow, col - 1 + columnOffset ]);
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

