import {
  DEFAULT_CELL_HEIGHT,
  DEFAULT_CELL_WIDTH,
  connectElements,
  getBounds,
  getDockingPoint,
  getMid
} from '../utils/layoutUtil.js';
import { sortByInstance, findMergingStartingPosition } from '../utils/elementUtils.js';

export default {
  'addToGrid': ({ element, grid, stack, visited, skipped, force }) => {
    const nextElements = [];

    console.log('visiting');
    console.log(element);

    let attachedOutgoing = (element.attachers || [])
      .map(att => att.outgoing.reverse())
      .flat()
      .map(out => out.targetRef);

    attachedOutgoing = sortByInstance(attachedOutgoing, 'bpmn:Gateway');
    attachedOutgoing = sortByInstance(attachedOutgoing, 'bpmn:Task');

    // handle boundary events
    attachedOutgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }

      const nextIncoming = (nextElement.incoming || [])
        .map(out => out.sourceRef)
        .filter(el => el);


      const nextOutgoing = (nextElement.outgoing || [])
        .map(out => out.targetRef)
        .filter(el => el);

      const isMerging = nextIncoming.length > 1;
      const skipThis = isMerging && !nextIncoming.every(el => visited.has(el));

      const isSplitting = nextOutgoing.length > 1;

      if ((skipThis || isSplitting) && !force && !stack.indexOf(element) !== -1 && !skipped.indexOf(element) !== -1) {
        console.log('skip');
        skipped.push(element);
        return;
      }

      console.log('adding');
      console.log(nextElement);

      if (isMerging) {
        console.log('to row');
        grid.addToNextEmptyRowAndColumn(findMergingStartingPosition(grid, nextIncoming), nextElement, 0);
      } else if (isSplitting) {
        console.log('to column');
        grid.addToNextEmptyColumn(grid.find(element), nextElement);
      } else {
        console.log('after');
        grid.addToNextEmptyRowAndColumn(grid.find(element), nextElement, 1);
      }

      nextElements.push(nextElement);
      visited.add(nextElement);
      force = false;
    });

    return nextElements;
  },

  'createElementDi': ({ element, row, col, diFactory }) => {
    const hostBounds = getBounds(element, row, col);

    const DIs = [];
    (element.attachers || []).forEach((att, i, arr) => {
      att.gridPosition = { row, col };
      const bounds = getBounds(att, row, col, element);

      // distribute along lower edge
      bounds.x = hostBounds.x + (i + 1) * (hostBounds.width / (arr.length + 1)) - bounds.width / 2;

      const attacherDi = diFactory.createDiShape(att, bounds, {
        id: att.id + '_di'
      });
      att.di = attacherDi;
      att.gridPosition = { row, col };

      DIs.push(attacherDi);
    });

    return DIs;
  },

  'createConnectionDi': ({ element, row, col, layoutGrid, diFactory }) => {
    const attachers = element.attachers || [];

    return attachers.flatMap(att => {
      const outgoing = att.outgoing || [];

      return outgoing.map(out => {
        const target = out.targetRef;
        const waypoints = connectElements(att, target, layoutGrid);

        // Correct waypoints if they don't automatically attach to the bottom
        ensureExitBottom(att, waypoints, [ row, col ]);

        const connectionDi = diFactory.createDiEdge(out, waypoints, {
          id: out.id + '_di'
        });

        return connectionDi;
      });
    });
  }
};


// function insertIntoGrid(newElement, host, grid) {
//   const [ row, col ] = grid.find(host);

//   // Grid is occupied
//   if (grid.get(row + 1, col) || grid.get(row + 1, col + 1)) {
//     grid.createRow(row);
//   }

//   // Host has element directly after, add space
//   // if (grid.get(row, col + 1)) {
//   //   grid.addAfter(host, null);
//   // }

//   grid.add(newElement, [ row + 1, col + 1 ]);
// }

function ensureExitBottom(source, waypoints, [ row, col ]) {

  const sourceDi = source.di;
  const sourceBounds = sourceDi.get('bounds');
  const sourceMid = getMid(sourceBounds);

  const dockingPoint = getDockingPoint(sourceMid, sourceBounds, 'b');
  if (waypoints[0].x === dockingPoint.x && waypoints[0].y === dockingPoint.y) {
    return;
  }

  if (waypoints.length === 2) {
    const newStart = [
      dockingPoint,
      { x: dockingPoint.x, y: (row + 1) * DEFAULT_CELL_HEIGHT },
      { x: (col + 1) * DEFAULT_CELL_WIDTH, y: (row + 1) * DEFAULT_CELL_HEIGHT },
      { x: (col + 1) * DEFAULT_CELL_WIDTH, y: (row + 0.5) * DEFAULT_CELL_HEIGHT },
    ];

    waypoints.splice(0, 1, ...newStart);
    return;
  }

  // add waypoints to exit bottom and connect to existing path
  const newStart = [
    dockingPoint,
    { x: dockingPoint.x, y: (row + 1) * DEFAULT_CELL_HEIGHT },
    { x: waypoints[1].x, y: (row + 1) * DEFAULT_CELL_HEIGHT },
  ];

  waypoints.splice(0, 1, ...newStart);
  return;
}