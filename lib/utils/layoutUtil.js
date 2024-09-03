import { getDefaultSize } from '../di/DiUtil.js';

export const DEFAULT_CELL_WIDTH = 140;
export const DEFAULT_CELL_HEIGHT = 160;

export function getMid(bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
}

export function getDockingPoint(point, rectangle, dockingDirection = 'r', targetOrientation = 'top-left') {

  // ensure we end up with a specific docking direction
  // based on the targetOrientation, if <h|v> is being passed

  if (dockingDirection === 'h') {
    dockingDirection = /left/.test(targetOrientation) ? 'l' : 'r';
  }

  if (dockingDirection === 'v') {
    dockingDirection = /top/.test(targetOrientation) ? 't' : 'b';
  }

  if (dockingDirection === 't') {
    return { original: point, x: point.x, y: rectangle.y };
  }

  if (dockingDirection === 'r') {
    return { original: point, x: rectangle.x + rectangle.width, y: point.y };
  }

  if (dockingDirection === 'b') {
    return { original: point, x: point.x, y: rectangle.y + rectangle.height };
  }

  if (dockingDirection === 'l') {
    return { original: point, x: rectangle.x, y: point.y };
  }

  throw new Error('unexpected dockingDirection: <' + dockingDirection + '>');
}

/**
     * Modified Manhattan layout: Uses space between grid coloumns to route connections
     * if direct connection is not possible.
     * @param {*} source
     * @param {*} target
     * @returns waypoints
     */
export function connectElements(source, target, layoutGrid) {
  const isSourceGateway = source.$instanceOf('bpmn:Gateway');
  const isTargetGateway = target.$instanceOf('bpmn:Gateway');

  const sourceDi = source.di;
  const targetDi = target.di;

  const sourceBounds = sourceDi.get('bounds');
  const targetBounds = targetDi.get('bounds');

  const sourceMid = getMid(sourceBounds);
  const targetMid = getMid(targetBounds);

  const dX = target.gridPosition.col - source.gridPosition.col;
  const dY = target.gridPosition.row - source.gridPosition.row;

  const dockingSource = `${(dY > 0 ? 'bottom' : 'top')}-${dX > 0 ? 'right' : 'left'}`;
  const dockingTarget = `${(dY > 0 ? 'top' : 'bottom')}-${dX > 0 ? 'left' : 'right'}`;

  // Source === Target ==> Build loop
  if (dX === 0 && dY === 0) {
    const { x, y } = coordinatesToPosition(source.gridPosition.row, source.gridPosition.col);
    return [
      getDockingPoint(sourceMid, sourceBounds, 'r', dockingSource),
      { x: x + DEFAULT_CELL_WIDTH, y: sourceMid.y },
      { x: x + DEFAULT_CELL_WIDTH, y: y },
      { x: targetMid.x, y: y },
      getDockingPoint(targetMid, targetBounds, 't', dockingTarget)
    ];
  }

  // connect horizontally
  if (dY === 0) {
    if (!isDirectPathBlocked(source, target, layoutGrid)) {

      // if space is clear, connect directly
      return [
        getDockingPoint(sourceMid, sourceBounds, 'h', dockingSource),
        getDockingPoint(targetMid, targetBounds, 'h', dockingTarget)
      ];
    } else {
      if (dX > 0) {

        // Route on bottom
        return [
          getDockingPoint(sourceMid, sourceBounds, 'b'),
          { x: sourceMid.x, y: sourceMid.y + DEFAULT_CELL_HEIGHT / 2 },
          { x: targetMid.x, y: sourceMid.y + DEFAULT_CELL_HEIGHT / 2 },
          getDockingPoint(targetMid, targetBounds, 'b')
        ];
      } else {

        // Route on top
        return [
          getDockingPoint(sourceMid, sourceBounds, 't'),
          { x: sourceMid.x, y: sourceMid.y - DEFAULT_CELL_HEIGHT / 2 },
          { x: targetMid.x, y: sourceMid.y - DEFAULT_CELL_HEIGHT / 2 },
          getDockingPoint(targetMid, targetBounds, 't')
        ];
      }
    }
  }

  // connect vertically
  if (dX === 0) {
    if (isDirectPathBlocked(source, target, layoutGrid)) {

      // Route parallel
      const yOffset = -Math.sign(dY) * DEFAULT_CELL_HEIGHT / 2;
      return [
        getDockingPoint(sourceMid, sourceBounds, 'r'),
        { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y }, // out right
        { x: targetMid.x + DEFAULT_CELL_WIDTH / 2, y: targetMid.y + yOffset },
        { x: targetMid.x, y: targetMid.y + yOffset },
        getDockingPoint(targetMid, targetBounds, Math.sign(yOffset) > 0 ? 'b' : 't')
      ];
    } else {

      // if space is clear, connect directly
      return [ getDockingPoint(sourceMid, sourceBounds, 'v', dockingSource),
        getDockingPoint(targetMid, targetBounds, 'v', dockingTarget)
      ];
    }
  }

  const directManhattan = directManhattanConnect(source, target, layoutGrid);

  if (directManhattan) {
    const startPoint = getDockingPoint(sourceMid, sourceBounds, directManhattan[0], dockingSource);
    const endPoint = getDockingPoint(targetMid, targetBounds, directManhattan[1], dockingTarget);

    const midPoint = directManhattan[0] === 'h' ? { x: endPoint.x, y: startPoint.y } : { x: startPoint.x, y: endPoint.y };

    return [
      startPoint,
      midPoint,
      endPoint
    ];
  }

  const yOffset = Math.sign(dX) * Math.sign(dY) * DEFAULT_CELL_HEIGHT / 2;

  if (!isSourceGateway && !isTargetGateway) {
    return [
      getDockingPoint(sourceMid, sourceBounds, 'r', dockingSource),
      { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y }, // out right
      { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y + yOffset }, // to target row
      { x: targetMid.x - DEFAULT_CELL_WIDTH / 2, y: sourceMid.y + yOffset }, // to target column
      { x: targetMid.x - DEFAULT_CELL_WIDTH / 2, y: targetMid.y }, // to mid
      getDockingPoint(targetMid, targetBounds, 'l', dockingTarget)
    ];
  } else if (isSourceGateway && !isTargetGateway) {
    return [
      getDockingPoint(sourceMid, sourceBounds, yOffset > 0 ? 'b' : 't', dockingSource),
      { x: sourceMid.x, y: sourceMid.y + yOffset }, // to target row
      { x: targetMid.x - DEFAULT_CELL_WIDTH / 2, y: sourceMid.y + yOffset }, // to target column
      { x: targetMid.x - DEFAULT_CELL_WIDTH / 2, y: targetMid.y }, // to mid
      getDockingPoint(targetMid, targetBounds, 'l', dockingTarget)
    ];
  } else if (!isSourceGateway && isTargetGateway) {
    return [
      getDockingPoint(sourceMid, sourceBounds, 'r', dockingSource),
      { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y }, // out right
      { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y + yOffset }, // to target row
      { x: targetMid.x, y: sourceMid.y + yOffset }, // to target column
      getDockingPoint(targetMid, targetBounds, sourceMid.y + yOffset > targetMid.y ? 'b' : 't', dockingTarget)
    ];
  } else {
    return [
      getDockingPoint(sourceMid, sourceBounds, yOffset > 0 ? 'b' : 't', dockingSource),
      { x: sourceMid.x, y: sourceMid.y + yOffset }, // to target row
      { x: targetMid.x, y: sourceMid.y + yOffset }, // to target column
      getDockingPoint(targetMid, targetBounds, sourceMid.y + yOffset > targetMid.y ? 'b' : 't', dockingTarget)
    ];
  }
}

// helpers /////
export function coordinatesToPosition(row, col) {
  return {
    width: DEFAULT_CELL_WIDTH,
    height: DEFAULT_CELL_HEIGHT,
    x: col * DEFAULT_CELL_WIDTH,
    y: row * DEFAULT_CELL_HEIGHT
  };
}

export function getBounds(element, row, col, attachedTo) {
  const { width, height } = getDefaultSize(element);

  // Center in cell
  if (!attachedTo) {
    return {
      width, height,
      x: (col * DEFAULT_CELL_WIDTH) + (DEFAULT_CELL_WIDTH - width) / 2,
      y: row * DEFAULT_CELL_HEIGHT + (DEFAULT_CELL_HEIGHT - height) / 2
    };
  }

  const hostBounds = getBounds(attachedTo, row, col);

  return {
    width, height,
    x: Math.round(hostBounds.x + hostBounds.width / 2 - width / 2),
    y: Math.round(hostBounds.y + hostBounds.height - height / 2)
  };
}

function isDirectPathBlocked(source, target, layoutGrid) {
  const { row: sourceRow, col: sourceCol } = source.gridPosition;
  const { row: targetRow, col: targetCol } = target.gridPosition;

  const dX = targetCol - sourceCol;
  const dY = targetRow - sourceRow;

  let totalElements = 0;

  if (dX) {
    totalElements += layoutGrid.getElementsInRange({ row: sourceRow, col: sourceCol }, { row: sourceRow, col: targetCol }).length;
  }

  if (dY) {
    totalElements += layoutGrid.getElementsInRange({ row: sourceRow, col: targetCol }, { row: targetRow, col: targetCol }).length;
  }

  return totalElements > 2;
}

function directManhattanConnect(source, target, layoutGrid) {
  const { row: sourceRow, col: sourceCol } = source.gridPosition;
  const { row: targetRow, col: targetCol } = target.gridPosition;

  const dX = targetCol - sourceCol;
  const dY = targetRow - sourceRow;

  // Only directly connect left-to-right flow
  if (!(dX > 0 && dY !== 0)) {
    return;
  }

  // If below, go down then horizontal
  if (dY > 0) {
    let totalElements = 0;
    const bendPoint = { row: targetRow, col: sourceCol };
    totalElements += layoutGrid.getElementsInRange({ row: sourceRow, col: sourceCol }, bendPoint).length;
    totalElements += layoutGrid.getElementsInRange(bendPoint, { row: targetRow, col: targetCol }).length;

    return totalElements > 2 ? false : [ 'v', 'h' ];
  } else {

    // If above, go horizontal than vertical
    let totalElements = 0;
    const bendPoint = { row: sourceRow, col: targetCol };

    totalElements += layoutGrid.getElementsInRange({ row: sourceRow, col: sourceCol }, bendPoint).length;
    totalElements += layoutGrid.getElementsInRange(bendPoint, { row: targetRow, col: targetCol }).length;

    return totalElements > 2 ? false : [ 'h', 'v' ];
  }
}
