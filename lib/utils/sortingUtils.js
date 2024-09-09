
export function sortByType(array, type) {

  // A custom sort function that sorts elements with $type equal to "type" to the front
  return array.sort((a, b) => {
    if (a.$type == type && b.$type != type) {
      return -1;
    }
    if (a.$type != type && b.$type == type) {
      return 1;
    }
    return 0;
  });
}

/*
  This function is used for sorting already placed elements before revisiting them (either skipped or reversedSkipped).
  Left-most elements (smallest column index) are sorted to the back to be popped first.
  If elements have the same column, top-most elements (smallest row index) are sorted to the back to be popped first.
*/
export function sortByPosition(grid, elements) {
  return elements.sort((a, b) => {
    const aPosition = grid.find(a);
    const bPosition = grid.find(b);
    if (aPosition[1] !== bPosition[1]) {

      // smallest column to the back to be popped first
      return Math.sign(bPosition[1] - aPosition[1]);
    } else {
      if (bPosition[0] !== aPosition[0]) {

        // highest row to the back to be popped first
        return Math.sign(bPosition[0] - aPosition[0]);
      } else {

        // this should not happen
        return 0;
      }
    }
  });
}

/*
  This function is used for sorting already placed elements before revisiting them (either skipped or reversedSkipped).
  Elements that are neither splitting (boundary), or merging (coined "none") are sorted to the back to be popped first.
  Subsequently, splitting elements should be visited sooner than elements with boundary events.
*/
export function sortBySplittingMergingAndNone(skippedElements) {
  return skippedElements.sort((a, b) => {
    const isASplitting = (a.outgoing || []).length > 1;
    const isBSplitting = (b.outgoing || []).length > 1;
    const hasABoundaryEvents = (a.attachers || []).length > 0;
    const hasBBoundaryEvents = (b.attachers || []).length > 0;
    const isAMerging = (a.incoming || []).length > 1;
    const isBMerging = (b.incoming || []).length > 1;
    if ((isAMerging || isASplitting || hasABoundaryEvents) && !(isBMerging || isBSplitting || hasBBoundaryEvents)) {
      return -1;
    }
    if (!(isAMerging || isASplitting || hasABoundaryEvents) && (isBMerging || isBSplitting || hasBBoundaryEvents)) {
      return 1;
    }
    if (isASplitting && hasBBoundaryEvents) {
      return 1;
    }
    if (isBSplitting && hasABoundaryEvents) {
      return -1;
    }
    return 0;
  });
}

/*
  This function is used for sorting outgoing elements behind an already placed element.
  Splitting elements or elements with boundary events (essentially also splitting) are sorted to the front, while merging elements are sorted to the back.
  This helps with the layout of the diagram:
    Elements are placed according to their "index" when looping through them
    Splitting elements are "simpler", as in their following elements are probably not placed yet
    Splitting elements come "earlier" in the diagram than merging elements.
*/
export function sortBySplittingAndMerging(outgoing) {
  return outgoing.sort((a, b) => {
    const isASplitting = (a.outgoing || []).length > 1 || (a.attachers || []).length > 0;
    const isBSplitting = (b.outgoing || []).length > 1 || (b.attachers || []).length > 0;
    const isAMerging = (a.incoming || []).length > 1;
    const isBMerging = (b.incoming || []).length > 1;
    if (isAMerging && isBSplitting) {
      return 1;
    } else if (isASplitting && isBMerging) {
      return -1;
    } else {
      return 0;
    }
  });
}

export function findMergingStartingPosition(grid, elements) {
  let smallestRow = -1;
  let highestColumn = -1;
  elements.forEach(el => {
    let position = el.$type == 'bpmn:BoundaryEvent' ? grid.find(el.attachedToRef) : grid.find(el);
    if (el.$type == 'bpmn:BoundaryEvent') {
      position[0] += 1;
    }
    if (smallestRow === -1 || position[0] !== -1 && position[0] < smallestRow) {
      smallestRow = position[0];
    }
    if (highestColumn === -1 || position[1] !== -1 && position[1] > highestColumn) {
      highestColumn = position[1];
    }
  });
  return [ smallestRow, highestColumn ];
}

export function findSplittingStartingPosition(grid, elements) {
  let highestRow = null;
  let smallestColumn = null;
  elements.forEach(el => {
    const position = el.$type == 'bpmn:BoundaryEvent' ? grid.find(el.attachedToRef) : grid.find(el);
    if (highestRow == null || position[0] !== -1 && position[0] > highestRow) {
      highestRow = position[0];
    }
    if (smallestColumn == null || position[0] !== -1 && position[1] !== -1 && position[1] < smallestColumn) {
      smallestColumn = position[1];
    }
  });
  return [ highestRow, smallestColumn ];
}
