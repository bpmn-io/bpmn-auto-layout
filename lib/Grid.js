export class Grid {
  constructor() {
    this.grid = [];
    this.highestRow = 0;
    this.highestColumn = 0;
    this.smallestColumn = 0;
  }

  updateHighest(position) {
    const [ row, col ] = position;

    if (row > this.highestRow) {
      this.highestRow = row;
    }
    if (col > this.highestColumn) {
      this.highestColumn = col;
    }
    if (col < this.smallestColumn) {
      this.smallestColumn = col;
    }
  }

  ensureRow(row) {
    if (row > this.highestRow) {
      for (let rowIndex = this.highestRow + 1; rowIndex <= row; rowIndex++) {
        console.log(rowIndex);
        this.grid[rowIndex] = [];
      }
    }
  }

  checkPosition(position) {
    console.log(position);
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
    this.grid.push([ ...new Array(10).fill(null), element ]);
    this.highestRow = this.grid.length - 1;
  }

  addToNextEmptyColumn(position, newElement) {
    const [ row, col ] = position;
    let emptyCol = col + 1;

    if (row <= this.highestRow) {
      while (this.getElementsInRange({ row: row, col: emptyCol }, { row: this.highestRow, col: emptyCol }).length !== 0) {
        emptyCol += 1;
      }
    }

    this.ensureRow(row);
    this.checkPosition([ row, emptyCol ]);

    console.log([ row, emptyCol ]);
    this.grid[row][emptyCol] = newElement;
    this.updateHighest([ row, emptyCol ]);
  }

  addToNextEmptyRowAndColumn(position, newElement, rowOffset) {
    const [ row, col ] = position;
    let emptyRow = row + rowOffset;
    let emptyCol = col + 1;

    if (emptyCol <= this.highestColumn) {
      while (this.getElementsInRange({ row: emptyRow, col: emptyCol }, { row: emptyRow, col: this.highestColumn }).length !== 0) {
        console.log(emptyRow);
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

    console.log([ emptyRow, emptyCol ]);
    this.grid[emptyRow][emptyCol] = newElement;
    this.updateHighest([ emptyRow, emptyCol ]);
  }

  addToNextEmptyRow(position, newElement, rowOffset) {
    const [ row, col ] = position;
    let emptyRow = row + rowOffset;

    if (col + 1 <= this.highestColumn) {
      while (this.getElementsInRange({ row: emptyRow, col: col + 1 }, { row: emptyRow, col: this.highestColumn }).length !== 0) {
        console.log(emptyRow);
        emptyRow += 1;
      }
    }

    this.ensureRow(emptyRow);
    this.checkPosition([ emptyRow, col + 1 ]);

    console.log([ emptyRow, col + 1 ]);
    this.grid[emptyRow][col + 1] = newElement;
    this.updateHighest([ emptyRow, col + 1 ]);
  }


  addToPreviousEmptyColumn(position, newElement) {
    const [ row, col ] = position;
    let emptyCol = col - 1;

    if (row <= this.highestRow) {
      while (this.getElementsInRange({ row: row, col: emptyCol }, { row: this.highestRow, col: emptyCol }).length !== 0) {
        emptyCol -= 1;
      }
    }

    this.ensureRow(row);
    this.checkPosition([ row, emptyCol ]);

    console.log([ row, emptyCol ]);
    this.grid[row][emptyCol] = newElement;
    this.updateHighest([ row, emptyCol ]);
  }

  addToPreviousEmptyRowAndColumn(position, newElement, rowOffset) {
    const [ row, col ] = position;
    let emptyRow = row + rowOffset;
    let emptyCol = col - 1;

    if (emptyCol >= this.smallestColumn) {
      while (this.getElementsInRange({ row: emptyRow, col: emptyCol }, { row: emptyRow, col: this.smallestColumn }).length !== 0) {
        console.log(emptyRow);
        emptyRow += 1;
      }
    }
    if (emptyRow <= this.highestRow) {
      while (this.getElementsInRange({ row: emptyRow, col: emptyCol }, { row: this.highestRow, col: emptyCol }).length !== 0) {
        emptyCol -= 1;
      }
    }

    this.ensureRow(emptyRow);
    this.checkPosition([ emptyRow, emptyCol ]);

    console.log([ emptyRow, emptyCol ]);
    this.grid[emptyRow][emptyCol] = newElement;
    this.updateHighest([ emptyRow, emptyCol ]);
  }

  addToPreviousEmptyRow(position, newElement, rowOffset) {
    console.log('previous empty row');
    const [ row, col ] = position;
    let emptyRow = row + rowOffset;

    if (col - 1 >= this.smallestColumn) {
      while (this.getElementsInRange({ row: emptyRow, col: col - 1 }, { row: emptyRow, col: this.smallestColumn }).length !== 0) {
        console.log(emptyRow);
        emptyRow += 1;
      }
    }

    this.ensureRow(emptyRow);
    this.checkPosition([ emptyRow, col - 1 ]);

    console.log([ emptyRow, col - 1 ]);
    this.grid[emptyRow][col - 1] = newElement;
    this.updateHighest([ emptyRow, col - 1 ]);
  }

  find(element) {
    let found = false;
    let row, col;
    row = this.grid.findIndex((row) => {
      col = row.findIndex((el) => {
        found = el === element;
        return el === element;
      });

      return found;
    });
    console.log('found here');
    console.log([ row, col ]);

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

