'use strict';

var ORIENTATION_THRESHOLD = {
  'h:h': 20,
  'v:v': 20,
  'h:v': -10,
  'v:h': -10
};
var ALIGNED_THRESHOLD = 2;

function getExpandedBounds(element) {
  var bounds = {
    x: Number.MAX_SAFE_INTEGER,
    y: Number.MAX_SAFE_INTEGER,
    width: 100,
    height: 80
  };
  var padding = 36 / 2;
  if (element.flowElements) {

    // determine x/y bounds
    element.flowElements.forEach(flowElement => {
      var flowBounds = flowElement.bounds;
      if (flowBounds) {
        bounds.x = flowBounds.x < bounds.x ? flowBounds.x : bounds.x;
        bounds.y = flowBounds.y < bounds.y ? flowBounds.y : bounds.y;
      }
    });

    // determine width/height bounds
    element.flowElements.forEach(flowElement => {
      var flowBounds = flowElement.bounds;
      if (flowBounds) {
        var newWidth = (flowBounds.x - bounds.x) + flowBounds.width;
        var newHeight = (flowBounds.y - bounds.y) + flowBounds.height;
        bounds.width = bounds.width < newWidth ? newWidth : bounds.width;
        bounds.height = bounds.height < newHeight ? newHeight : bounds.height;
      }
    });
    bounds.x -= padding;
    bounds.y -= padding;
    bounds.width += (padding * 2);
    bounds.height += padding * 2;
  }
  return bounds;
}

// see documentation bpmn.io/diagram-js/layout/ManhattanLayout
function connectRectangles(source, target, preferredLayout = 'h:h') {
  var threshold = ORIENTATION_THRESHOLD[preferredLayout] || 0;
  var orientation = getOrientation(source, target, threshold);
  var directions = getDirections(orientation, preferredLayout);
  var start = getMid(source);
  var end = getMid(target);

  // overlapping elements
  if (!directions) {
    return;
  }
  if (directions === 'h:h') {
    switch (orientation) {
    case 'top-right':
    case 'right':
    case 'bottom-right':
      start = { original: start, x: source.x, y: start.y };
      end = { original: end, x: target.x + target.width, y: end.y };
      break;
    case 'top-left':
    case 'left':
    case 'bottom-left':
      start = { original: start, x: source.x + source.width, y: start.y };
      end = { original: end, x: target.x, y: end.y };
      break;
    }
  } else if (directions === 'v:v') {
    switch (orientation) {
    case 'top-left':
    case 'top':
    case 'top-right':
      start = { original: start, x: start.x, y: source.y + source.height };
      end = { original: end, x: end.x, y: target.y };
      break;
    case 'bottom-left':
    case 'bottom':
    case 'bottom-right':
      start = { original: start, x: start.x, y: source.y };
      end = { original: end, x: end.x, y: target.y + target.height };
      break;
    }
  } else if (directions === 'v:h') {
    switch (orientation) {
    case 'top-left':
    case 'top':
    case 'top-right':
      start = { original: start, x: start.x, y: source.y + source.height };
      end = { original: end, x: target.x + target.width, y: end.y };
      break;
    case 'bottom-left':
    case 'bottom':
    case 'bottom-right':
      start = { original: start, x: start.x, y: source.y };
      end = { original: end, x: target.x, y: end.y };
      break;
    }
  } else if (directions === 'h:v') {
    switch (orientation) {
    case 'top-left':
    case 'top':
    case 'top-right':
      start = { original: start, x: source.x, y: start.y };
      end = { original: end, x: end.x, y: target.y };
      break;
    case 'bottom-left':
    case 'bottom':
    case 'bottom-right':
      start = { original: start, x: start.x, y: source.y };
      start = { original: start, x: source.x + source.width, y: start.y };
      break;
    }
  }

  return connectPoints(start, end, directions);
}

function connectPoints(a, b, directions) {
  var points = [];
  if (!pointsAligned(a, b)) {
    points = getBendpoints(a, b, directions);
  }
  points.unshift(a);
  points.push(b);
  return points;
}

function getBendpoints(a, b, directions) {
  directions = directions || 'h:h';
  var xmid, ymid;

  // one point, next to a
  if (directions === 'h:v') {
    return [{ x: b.x, y: a.y }];
  } else

  // one point, above a
  if (directions === 'v:h') {
    return [{ x: a.x, y: b.y }];
  } else {

    // vertical edge xmid
    if (directions === 'h:h') {
      xmid = Math.round((b.x - a.x) / 2 + a.x);
      return [
        { x: xmid, y: a.y },
        { x: xmid, y: b.y }
      ];
    } else {

      // horizontal edge ymid
      if (directions === 'v:v') {
        ymid = Math.round((b.y - a.y) / 2 + a.y);
        return [
          { x: a.x, y: ymid },
          { x: b.x, y: ymid }
        ];
      } else {
        throw new Error(
          'unknown directions: <' + directions + '>: ' +
          'directions must be specified as {a direction}:{b direction} (direction in h|v)');
      }
    }
  }
}

// see documentation bpmn.io/diagram-js/layout/LayoutUtil &&
// bpmn.io/diagram-js/util/geometry
function getMid(bounds) {
  return roundPoint({
    x: bounds.x + (bounds.width || 0) / 2,
    y: bounds.y + (bounds.height || 0) / 2
  });
}

function pointsAligned(a, b) {
  if (Math.abs(a.x - b.x) <= ALIGNED_THRESHOLD) {
    return 'h';
  }
  if (Math.abs(a.y - b.y) <= ALIGNED_THRESHOLD) {
    return 'v';
  }
  return false;
}

function getDirections(orientation, defaultLayout) {
  switch (orientation) {
  case 'intersect':
    return null;
  case 'top':
  case 'bottom':
    return 'v:v';
  case 'left':
  case 'right':
    return 'h:h';

    // 'top-left'
    // 'top-right'
    // 'bottom-left'
    // 'bottom-right'
  default:
    return defaultLayout;
  }
}

function roundPoint(point) {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y)
  };
}

function getOrientation(rect, reference, padding) {
  var rectOrientation = asTRBL(rect);
  var referenceOrientation = asTRBL(reference);
  var top = rectOrientation.bottom + padding <= referenceOrientation.top;
  var right = rectOrientation.left - padding >= referenceOrientation.right;
  var bottom = rectOrientation.top - padding >= referenceOrientation.bottom;
  var left = rectOrientation.right + padding <= referenceOrientation.left;
  var vertical = top ? 'top' : (bottom ? 'bottom' : null);
  var horizontal = left ? 'left' : (right ? 'right' : null);
  if (horizontal && vertical) {
    return vertical + '-' + horizontal;
  } else {
    return horizontal || vertical || 'intersect';
  }
}

function asTRBL(bounds) {
  return {
    top: bounds.y,
    right: bounds.x + (bounds.width || 0),
    bottom: bounds.y + (bounds.height || 0),
    left: bounds.x
  };
}

function is(type, expected) {
  var baseType = expected.split(':')[1];
  var findType = type.indexOf(baseType) !== -1;
  return findType;
}

module.exports = {
  getExpandedBounds,
  connectRectangles,
  connectPoints,
  getBendpoints,
  getMid,
  pointsAligned,
  getDirections,
  roundPoint,
  getOrientation,
  asTRBL,
  is
};
