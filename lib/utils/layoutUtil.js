import { getDefaultSize } from '../di/DiUtil';

export const DEFAULT_CELL_WIDTH = 150;
export const DEFAULT_CELL_HEIGHT = 110;

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
    return [
      getDockingPoint(sourceMid, sourceBounds, 'r', dockingSource),
      { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y },
      { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y - DEFAULT_CELL_HEIGHT / 2 },
      { x: targetMid.x, y: sourceMid.y - DEFAULT_CELL_HEIGHT / 2 },
      getDockingPoint(targetMid, targetBounds, 't', dockingTarget)
    ];
  }

  // connect horizontally
  if (dY === 0) {
    if (layoutGrid.getElementsInRange(source.gridPosition, target.gridPosition).length > 2) {

      // Route on top
      return [
        getDockingPoint(sourceMid, sourceBounds, 't'),
        { x: sourceMid.x, y: sourceMid.y - DEFAULT_CELL_HEIGHT / 2 },
        { x: targetMid.x, y: sourceMid.y - DEFAULT_CELL_HEIGHT / 2 },
        getDockingPoint(targetMid, targetBounds, 't')
      ];
    } else {

      // if space is clear, connect directly
      return [
        getDockingPoint(sourceMid, sourceBounds, 'h', dockingSource),
        getDockingPoint(targetMid, targetBounds, 'h', dockingTarget)
      ];
    }
  }

  // connect vertically
  if (dX === 0) {
    if (layoutGrid.getElementsInRange(source.gridPosition, target.gridPosition).length > 2) {

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

  const yOffset = -Math.sign(dY) * DEFAULT_CELL_HEIGHT / 2;

  return [
    getDockingPoint(sourceMid, sourceBounds, 'r', dockingSource),
    { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y }, // out right
    { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: targetMid.y + yOffset }, // to target row
    { x: targetMid.x - DEFAULT_CELL_WIDTH / 2, y: targetMid.y + yOffset }, // to target column
    { x: targetMid.x - DEFAULT_CELL_WIDTH / 2, y: targetMid.y }, // to mid
    getDockingPoint(targetMid, targetBounds, 'l', dockingTarget)
  ];
}

// helpers /////
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