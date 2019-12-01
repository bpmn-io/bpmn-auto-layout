'use strict'

const map = require('lodash/collection/map')
const assign = require('lodash/object/assign')
const pick = require('lodash/object/pick')

const DiFactoryUtils = require('./DiFactoryUtils')

DiFactory.prototype._isExpanded = function (element) {
  return element && element.flowElements ? element.flowElements.length > 0 : false
}

function DiFactory (moddle) {
  this._model = moddle
}

DiFactory.prototype.create = function (type, attrs) {
  return this._model.create(type, attrs || {})
}

DiFactory.prototype.createDiLabel = function () {
  return this.create('bpmndi:BPMNLabel', {
    bounds: this.createDiBounds()
  })
}

DiFactory.prototype.createDiShape = function (semantic, bounds, attrs) {
  return this.create('bpmndi:BPMNShape', assign({
    bpmnElement: semantic,
    bounds: this.createDiBounds(bounds)
  }, attrs))
}

DiFactory.prototype.createDiBounds = function (bounds) {
  return this.create('dc:Bounds', bounds)
}

DiFactory.prototype.createDiWaypoints = function (waypoints) {
  return map(waypoints, function (pos) {
    return this.createDiWaypoint(pos)
  }, this)
}

DiFactory.prototype.createDiWaypoint = function (point) {
  return this.create('dc:Point', pick(point, ['x', 'y']))
}

DiFactory.prototype.createDiEdge = function (semantic, waypoints, attrs) {
  return this.create('bpmndi:BPMNEdge', assign({
    bpmnElement: semantic,
    waypoint: this.createDiWaypoints(waypoints)
  }, attrs))
}

DiFactory.prototype.createDiPlane = function (attrs) {
  return this.create('bpmndi:BPMNPlane', attrs)
}

DiFactory.prototype.createDiDiagram = function (attrs) {
  return this.create('bpmndi:BPMNDiagram', attrs)
}

// see documentation: bpmn.io/bpmn-js/lib/features/modeling/BpmnFactory
DiFactory.prototype.createBpmnElementDi = function (elementType, attrs, pos) {
  let di
  let businessObject
  attrs = attrs || {}
  if (elementType === 'diagram') {
    di = this.createDiDiagram({
      id: attrs.id
    })
  } else
  if (elementType === 'root') {
    di = this.createDiPlane(attrs)
  } else
  if (elementType === 'connection') {
    var connection = attrs
    const targetRef = connection.get('targetRef')
    const sourceRef = connection.get('sourceRef')
    var targetBounds = targetRef.bounds
    var sourceBounds = sourceRef.bounds
    var preferredLayout = 'h:h'
    if (DiFactoryUtils.is(sourceRef.$type, 'bpmn:StartEvent') || DiFactoryUtils.is(targetRef.$type, 'bpmn:EndEvent')) {
      preferredLayout = 'h:v'
    }
    var waypoints = DiFactoryUtils.connectRectangles(sourceBounds, targetBounds, preferredLayout)
    businessObject = this.create(attrs.$type, connection)
    di = this.createDiEdge(businessObject, waypoints, {
      id: '_BPMNConnection_' + connection.id
    })
  } else {
    const isExpanded = this._isExpanded(attrs)
    attrs.isExpanded = isExpanded
    const size = this._getDefaultSize(attrs)
    var bounds = assign({}, size, pos)
    businessObject = this.create(attrs.$type, attrs)
    di = this.createDiShape(businessObject, bounds, {
      id: '_BPMNShape_' + attrs.id,
      isExpanded
    })
  }
  return di
}

DiFactory.prototype._getDefaultSize = function (element) {
  const elementType = element.$type

  if (DiFactoryUtils.is(elementType, 'bpmn:SubProcess')) {
    element.isExpanded = this._isExpanded(element)
    if (element.isExpanded) {
      const bounds = DiFactoryUtils.getExpandedBounds(element)
      return bounds
    }
    return { width: 100, height: 80 }
  }

  if (DiFactoryUtils.is(elementType, 'bpmn:Task')) {
    return { width: 100, height: 80 }
  }

  if (DiFactoryUtils.is(elementType, 'bpmn:Gateway')) {
    return { width: 50, height: 50 }
  }

  if (DiFactoryUtils.is(elementType, 'bpmn:StartEvent') || DiFactoryUtils.is(elementType, 'bpmn:EndEvent')) {
    return { width: 36, height: 36 }
  }

  if (DiFactoryUtils.is(elementType, 'bpmn:Participant')) {
    if (element.isExpanded) {
      return DiFactoryUtils.getExpandedBounds(element)
    }
    return { width: 400, height: 100 }
  }

  if (DiFactoryUtils.is(elementType, 'bpmn:Lane')) {
    return { width: 400, height: 100 }
  }

  if (DiFactoryUtils.is(elementType, 'bpmn:DataObjectReference')) {
    return { width: 36, height: 50 }
  }

  if (DiFactoryUtils.is(elementType, 'bpmn:DataStoreReference')) {
    return { width: 50, height: 50 }
  }

  if (DiFactoryUtils.is(elementType, 'bpmn:TextAnnotation')) {
    return { width: 100, height: 30 }
  }

  return { width: 100, height: 80 }
}

module.exports = DiFactory
