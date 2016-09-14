'use strict';

var map = require('lodash/collection/map'),
    assign = require('lodash/object/assign'),
    pick = require('lodash/object/pick');

var ORIENTATION_THRESHOLD = {
      'h:h': 20,
      'v:v': 20,
      'h:v': -10,
      'v:h': -10
    };
var ALIGNED_THRESHOLD = 2;


function is(type, expected) {
  return type === expected;
}

function DiFactory(moddle) {
  this._model = moddle;
}

DiFactory.prototype.create = function(type, attrs) {
  return this._model.create(type, attrs || {});
};


DiFactory.prototype.createDiLabel = function() {
  return this.create('bpmndi:BPMNLabel', {
    bounds: this.createDiBounds()
  });
};

DiFactory.prototype.createDiShape = function(semantic, bounds, attrs) {

  return this.create('bpmndi:BPMNShape', assign({
    bpmnElement: semantic,
    bounds: this.createDiBounds(bounds)
  }, attrs));

};


DiFactory.prototype.createDiBounds = function(bounds) {
  return this.create('dc:Bounds', bounds);
};


DiFactory.prototype.createDiWaypoints = function(waypoints) {
  return map(waypoints, function(pos) {
    return this.createDiWaypoint(pos);
  }, this);
};

DiFactory.prototype.createDiWaypoint = function(point) {
  return this.create('dc:Point', pick(point, [ 'x', 'y' ]));
};


DiFactory.prototype.createDiEdge = function(semantic, waypoints, attrs) {
  return this.create('bpmndi:BPMNEdge', assign({
    bpmnElement: semantic,
    waypoint: this.createDiWaypoints(waypoints)
  }, attrs));
};

DiFactory.prototype.createDiPlane = function(attrs) {
  return this.create('bpmndi:BPMNPlane', {
    bpmnElement: attrs
  });
};

DiFactory.prototype.createDiDiagram = function(attrs) {
  return this.create('bpmndi:BPMNDiagram', attrs);
}

// see documentation: bpmn.io/bpmn-js/lib/features/modeling/BpmnFactory
DiFactory.prototype.createBpmnElementDi = function(elementType, attrs, pos) {
  var di,
      businessObject,
      size;

  attrs = attrs || {};

  if (elementType === 'diagram') {
    di = this.createDiDiagram({
      id: attrs.id
    });
  } else
  if (elementType === 'root') {
    di = this.createDiPlane(attrs);
  } else
  if (elementType === 'connection') {
    var connection = attrs;
    var targetBounds = connection.get('targetRef').bounds;
    var sourceBounds = connection.get('sourceRef').bounds;
    var waypoints = connectRectangles(sourceBounds, targetBounds);

    businessObject = this.create(attrs.$type, connection);

    di = this.createDiEdge(businessObject, waypoints, {
      id: '_BPMNConnection_' + connection.id
    });
  } else {
    var size = this._getDefaultSize(attrs.$type);
    var bounds = assign({}, pos, size);

    businessObject = this.create(attrs.$type, attrs);

    di = this.createDiShape(businessObject, bounds, {
      id: '_BPMNShape_' + attrs.id
    });

  }
  return di;
};

DiFactory.prototype._getDefaultSize = function(element) {

  if (is(element, 'bpmn:SubProcess')) {

    if (isExpanded(element)) {
      return { width: 350, height: 200 };
    } else {
      return { width: 100, height: 80 };
    }
  }

  if (is(element, 'bpmn:Task')) {
    return { width: 100, height: 80 };
  }

  if (is(element, 'bpmn:Gateway')) {
    return { width: 50, height: 50 };
  }

  if (is(element, 'bpmn:StartEvent') || is(element, 'bpmn:EndEvent')) {
    return { width: 36, height: 36 };
  }

  if (is(element, 'bpmn:Participant')) {
    if (!isExpanded(element)) {
      return { width: 400, height: 100 };
    } else {
      return { width: 600, height: 250 };
    }
  }

  if (is(element, 'bpmn:Lane')) {
    return { width: 400, height: 100 };
  }

  if (is(element, 'bpmn:DataObjectReference')) {
    return { width: 36, height: 50 };
  }

  if (is(element, 'bpmn:DataStoreReference')) {
    return { width: 50, height: 50 };
  }

  if (is(element, 'bpmn:TextAnnotation')) {
    return { width: 100, height: 30 };
  }

  return { width: 100, height: 80 };
};



//////////////////////////// helpers ////////////////////////////////
// see documentation bpmn.io/diagram-js/layout/ManhattanLayout
 function connectRectangles (source, target) {

  var preferredLayout = 'h:h';

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
  }

  if (directions === 'v:v') {

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
  }

  return connectPoints(start, end, directions);
};

function connectPoints(a, b, directions) {

  var points = [];

  if (!pointsAligned(a, b)) {
    points = getBendpoints(a, b, directions);
  }

  points.unshift(a);
  points.push(b);

  return points;
};

function getBendpoints (a, b, directions) {

  directions = directions || 'h:h';

  var xmid, ymid;

  // one point, next to a
  if (directions === 'h:v') {
    return [ { x: b.x, y: a.y } ];
  } else
  // one point, above a
  if (directions === 'v:h') {
    return [ { x: a.x, y: b.y } ];
  } else
  // vertical edge xmid
  if (directions === 'h:h') {
    xmid = Math.round((b.x - a.x) / 2 + a.x);

    return [
      { x: xmid, y: a.y },
      { x: xmid, y: b.y }
    ];
  } else
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
};


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

  var rectOrientation = asTRBL(rect),
      referenceOrientation = asTRBL(reference);

  var top = rectOrientation.bottom + padding <= referenceOrientation.top,
      right = rectOrientation.left - padding >= referenceOrientation.right,
      bottom = rectOrientation.top - padding >= referenceOrientation.bottom,
      left = rectOrientation.right + padding <= referenceOrientation.left;

  var vertical = top ? 'top' : (bottom ? 'bottom' : null),
      horizontal = left ? 'left' : (right ? 'right' : null);

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

module.exports = DiFactory;
