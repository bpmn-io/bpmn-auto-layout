'use strict';

var map = require('min-dash').map;
var assign = require('min-dash').assign;
var pick = require('min-dash').pick;

var DiUtil = require('./DiUtil');

var is = DiUtil.is;
var connectRectangles = DiUtil.connectRectangles;
var getExpandedBounds = DiUtil.getExpandedBounds;


function DiFactory(moddle) {
  this._model = moddle;
}

module.exports = DiFactory;


DiFactory.prototype._isExpanded = function(element) {
  return element && element.flowElements ? element.flowElements.length > 0 : false;
};

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
  var self = this;

  return map(waypoints, function(pos) {
    return self.createDiWaypoint(pos);
  });
};

DiFactory.prototype.createDiWaypoint = function(point) {
  return this.create('dc:Point', pick(point, ['x', 'y']));
};

DiFactory.prototype.createDiEdge = function(semantic, waypoints, attrs) {
  return this.create('bpmndi:BPMNEdge', assign({
    bpmnElement: semantic,
    waypoint: this.createDiWaypoints(waypoints)
  }, attrs));
};

DiFactory.prototype.createDiPlane = function(attrs) {
  return this.create('bpmndi:BPMNPlane', attrs);
};

DiFactory.prototype.createDiDiagram = function(attrs) {
  return this.create('bpmndi:BPMNDiagram', attrs);
};

// see documentation: bpmn.io/bpmn-js/lib/features/modeling/BpmnFactory
DiFactory.prototype.createBpmnElementDi = function(elementType, attrs, pos) {
  let di;
  let businessObject;
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
    var targetRef = connection.get('targetRef');
    var sourceRef = connection.get('sourceRef');
    var targetBounds = targetRef.bounds;
    var sourceBounds = sourceRef.bounds;
    var preferredLayout = 'h:h';
    if (is(sourceRef.$type, 'bpmn:StartEvent') || is(targetRef.$type, 'bpmn:EndEvent')) {
      preferredLayout = 'h:v';
    }
    var waypoints = connectRectangles(sourceBounds, targetBounds, preferredLayout);
    businessObject = this.create(attrs.$type, connection);
    di = this.createDiEdge(businessObject, waypoints, {
      id: '_BPMNConnection_' + connection.id
    });
  } else {
    var isExpanded = this._isExpanded(attrs);
    attrs.isExpanded = isExpanded;
    var size = this._getDefaultSize(attrs);
    var bounds = assign({}, size, pos);
    businessObject = this.create(attrs.$type, attrs);
    di = this.createDiShape(businessObject, bounds, {
      id: '_BPMNShape_' + attrs.id,
      isExpanded
    });
  }
  return di;
};

DiFactory.prototype._getDefaultSize = function(element) {
  var elementType = element.$type;

  if (is(elementType, 'bpmn:SubProcess')) {
    element.isExpanded = this._isExpanded(element);
    if (element.isExpanded) {
      var bounds = getExpandedBounds(element);
      return bounds;
    }
    return { width: 100, height: 80 };
  }

  if (is(elementType, 'bpmn:Task')) {
    return { width: 100, height: 80 };
  }

  if (is(elementType, 'bpmn:Gateway')) {
    return { width: 50, height: 50 };
  }

  if (is(elementType, 'bpmn:StartEvent') || is(elementType, 'bpmn:EndEvent')) {
    return { width: 36, height: 36 };
  }

  if (is(elementType, 'bpmn:Participant')) {
    if (element.isExpanded) {
      return getExpandedBounds(element);
    }
    return { width: 400, height: 100 };
  }

  if (is(elementType, 'bpmn:Lane')) {
    return { width: 400, height: 100 };
  }

  if (is(elementType, 'bpmn:DataObjectReference')) {
    return { width: 36, height: 50 };
  }

  if (is(elementType, 'bpmn:DataStoreReference')) {
    return { width: 50, height: 50 };
  }

  if (is(elementType, 'bpmn:TextAnnotation')) {
    return { width: 100, height: 30 };
  }

  return { width: 100, height: 80 };
};
