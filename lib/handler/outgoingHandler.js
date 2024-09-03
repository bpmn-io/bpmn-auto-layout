import { DEFAULT_CELL_HEIGHT,
  DEFAULT_CELL_WIDTH,
  connectElements,
  getBounds,
  getDockingPoint,
  getMid } from '../utils/layoutUtil.js';
import { findMergingStartingPosition, findSplittingStartingPosition, sortBySplittingAndMerging } from '../utils/sortingUtils.js';

export default {
  'addToGrid': ({ element, grid, visited, skipped, reversedSkipped, force, backwards }) => {
    const nextElements = [];

    // the outgoing and attachers handlers were combined to allow setting force to false when an element is placed
    // Handle attached elements
    let attachedOutgoing = (element.attachers || [])
      .map(att => att.outgoing.reverse())
      .flat()
      .map(out => out.targetRef)
      .filter(el => !visited.has(el));

    // we prefer splitting over merging elements
    attachedOutgoing = sortBySplittingAndMerging(attachedOutgoing);

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
      const isSplitting = nextOutgoing.length > 1 || (nextElement.attachers || []).length > 0;

      if ((isMerging || isSplitting) && !force) {
        if (skipped.indexOf(element) === -1) {
          skipped.push(element);
        }
        return;
      }

      if (isMerging) {
        grid.addToNextEmptyRowAndColumn(findMergingStartingPosition(grid, nextIncoming), nextElement, index);
      } else if (isSplitting) {
        grid.addToNextEmptyRowAndColumn(grid.find(element), nextElement, index + 1);
      } else {
        grid.addToNextEmptyRow(grid.find(element), nextElement, index + 1);
      }

      nextElements.push(nextElement);
      visited.add(nextElement);
      force = false;
    });

    // Handle outgoing paths
    let outgoing = (element.outgoing || [])
      .map(out => out.targetRef)
      .filter(el => !visited.has(el));

    // we prefer splitting over merging elements
    outgoing = sortBySplittingAndMerging(outgoing);

    outgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }

      const nextIncoming = (nextElement.incoming || [])
        .map(out => out.sourceRef);

      const nextOutgoing = (nextElement.outgoing || [])
        .map(out => out.targetRef);

      const isMerging = nextIncoming.length > 1;
      const isSplitting = nextOutgoing.length > 1 || (nextElement.attachers || []).length > 0;

      if ((isMerging || isSplitting) && !force) {
        if (skipped.indexOf(element) === -1) {
          skipped.push(element);
        }
        return;
      }

      if (isMerging) {
        grid.addToNextEmptyRowAndColumn(findMergingStartingPosition(grid, nextIncoming), nextElement, index);
      } else if (isSplitting) {
        grid.addToNextEmptyRowAndColumn(grid.find(element), nextElement, index);
      } else {
        grid.addToNextEmptyRow(grid.find(element), nextElement, index);
      }

      nextElements.unshift(nextElement);
      visited.add(nextElement);
      force = false;
      return;
    });

    // Handle incoming paths
    let incoming = (element.incoming || [])
      .map(out =>
      {
        if (out.sourceRef.$type == 'bpmn:BoundaryEvent') {
          return out.sourceRef.attachedToRef;
        } else {
          return out.sourceRef;
        }
      })
      .filter(el => !visited.has(el));

    incoming.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }

      let nextOutgoing = [
        ...(nextElement.outgoing || []).map(out => out.targetRef)
          .filter(el => el),
        ...(nextElement.attachers || [])
          .map(att => att.outgoing.reverse())
          .flat()
          .map(out => out.targetRef)
      ];

      const isCurrentMerging = incoming.length > 1;
      const isSplitting = nextOutgoing.length > 1 || (nextElement.attachers || []).length > 0;

      if ((isSplitting || isCurrentMerging) && !force) {
        if (reversedSkipped.indexOf(element) === -1) {
          reversedSkipped.push(element);
        }
        return;
      }

      // only layout backwards when taking from reversedSkipped
      if (backwards) {
        if (isSplitting) {
          const position = findSplittingStartingPosition(grid, nextOutgoing);

          // when placing backwards, make sure to start at row 1 at least
          if (position[0] === 0) {
            position[0] = 1;
          }
          grid.addToPreviousEmptyColumn(position, nextElement, index);
        } else if (isCurrentMerging) {
          const position = grid.find(element);

          // when placing backwards, make sure to start at row 1 at least
          if (position[0] === 0) {
            position[0] = 1;
          }
          grid.addToPreviousEmptyRow(position, nextElement, index);
        } else {
          grid.addToPreviousEmptyRow(grid.find(element), nextElement, index);
        }

        nextElements.unshift(nextElement);
        visited.add(nextElement);
        force = false;
      } else {
        if (reversedSkipped.indexOf(element) === -1) {
          reversedSkipped.push(element);
        }
      }
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
    const connections = [];

    const attachers = element.attachers || [];

    attachers.flatMap(att => {
      const outgoing = att.outgoing || [];

      return outgoing.map(out => {
        const target = out.targetRef;
        const waypoints = connectElements(att, target, layoutGrid);

        // Correct waypoints if they don't automatically attach to the bottom
        ensureExitBottom(att, waypoints, [ row, col ]);

        const connectionDi = diFactory.createDiEdge(out, waypoints, {
          id: out.id + '_di'
        });

        connections.push(connectionDi);
      });
    });

    const outgoing = element.outgoing || [];

    outgoing.map(out => {
      const target = out.targetRef;
      const waypoints = connectElements(element, target, layoutGrid);

      const connectionDi = diFactory.createDiEdge(out, waypoints, {
        id: out.id + '_di'
      });

      connections.push(connectionDi);
    });

    return connections;
  }
};

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