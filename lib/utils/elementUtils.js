export function isConnection(element) {
  return !!element.sourceRef;
}

export function isBoundaryEvent(element) {
  return !!element.attachedToRef;
}

export function sortByType(array, type) {

  // A custom sort function that sorts elements with $type equal to "type" to the front
  return array.sort((a, b) => {
    if (a.$type == type && b.$type != type) {
      return -1;
    }
    if (a.$type != type && b.$type == type) {
      return 1;
    }
    if ((a.incoming || []).length > 1 && (b.incoming || []).length === 1) {
      return 1;
    }
    if ((a.incoming || []).length === 1 && (b.incoming || []).length > 1) {
      return -1;
    }
    return 0;
  });
}

export function sortByInstance(array, instance) {

  // A custom sort function that sorts elements with $instanceOf equal to "instance" to the front
  return array.sort((a, b) => {
    if (a.$instanceOf(instance) && !b.$instanceOf(instance)) {
      return -1;
    }
    if (!a.$instanceOf(instance) && b.$instanceOf(instance)) {
      return 1;
    }
    if ((a.incoming || []).length > 1 && (b.incoming || []).length === 1) {
      return 1;
    }
    if ((a.incoming || []).length === 1 && (b.incoming || []).length > 1) {
      return -1;
    }
    return 0;
  });
}

export function sortByPosition(grid, array) {
  return array.sort((a, b) => {
    const aPosition = grid.find(a);
    const bPosition = grid.find(b);
    if (aPosition[1] !== bPosition[1]) {
      return Math.sign(aPosition[1] - bPosition[1]);
    } else {
      return Math.sign(aPosition[0] - bPosition[0]);
    }
  });
}

export function findMergingStartingPosition(grid, elements) {
  console.log('findMerging');

  let smallestRow = -1;
  let highestColumn = -1;
  elements.forEach(el => {
    const position = el.$type == 'bpmn:BoundaryEvent' ? grid.find(el.attachedToRef) : grid.find(el);
    if (smallestRow === -1 || position[0] !== -1 && position[0] < smallestRow) {
      smallestRow = position[0];
    }
    if (highestColumn === -1 || position[1] !== -1 && position[1] > highestColumn) {
      highestColumn = position[1];
    }
  });
  console.log([ smallestRow, highestColumn ]);
  return [ smallestRow, highestColumn ];
}

export function findSplittingStartingPosition(grid, elements) {
  console.log('findSplittingStartingPosition');

  let smallestRow = null;
  let smallestColumn = null;
  elements.forEach(el => {
    const position = el.$type == 'bpmn:BoundaryEvent' ? grid.find(el.attachedToRef) : grid.find(el);
    if (smallestRow == null || position[0] !== -1 && position[0] < smallestRow) {
      smallestRow = position[0];
    }
    if (smallestColumn == null || position[0] !== -1 && position[1] !== -1 && position[1] < smallestColumn) {
      smallestColumn = position[1];
    }
  });
  console.log([ smallestRow, smallestColumn ]);
  return [ smallestRow, smallestColumn ];
}