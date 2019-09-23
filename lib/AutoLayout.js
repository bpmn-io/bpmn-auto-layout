var BpmnModdle = require('bpmn-moddle'),
    DiFactory = require('./DiFactory');

var STDDIST = 25;
const PADDING = 36 / 2

function AutoLayout() {
  this.moddle = new BpmnModdle();
  this.DiFactory = new DiFactory(this.moddle);
}

module.exports = AutoLayout;

AutoLayout.prototype.layoutProcess = function(xmlStr, callback) {

  var self = this;
  var moddle = this.moddle;
  const createDiPlane = this.DiFactory.createDiPlane.bind(this.DiFactory)
  const createDiDiagram = this.DiFactory.createDiDiagram.bind(this.DiFactory)

  moddle.fromXML(xmlStr, function(error, moddleWithoutDi) {
    if (error) {
      return callback(error)
    }
    // create new di section
    const root = moddleWithoutDi.get('rootElements').find(el => el.$type === 'bpmn:Process')
    const rootDi = createDiPlane({
      id: 'BPMNPlane_1',
      bpmnElement: root
    })
    const newDiagram = createDiDiagram({
      id: 'BPMNDiagram_1',
      plane: rootDi
    })
    moddleWithoutDi.diagrams = [newDiagram]
    // create di
    self._breadFirstSearch(root, rootDi);
    moddle.toXML(moddleWithoutDi, callback);
  });
};


AutoLayout.prototype._breadFirstSearch = function (parentFlowElement, rootDi, parentGroup) {
  var children = parentFlowElement.flowElements;
  var startEvent = children && getStartEvent(children);

  // groups are elements with the same distance
  var group = {
    elements: [],
    connections: [],
    anchor: {
      x: 100,
      // 100 + mid of startEvent
      y: 100 + PADDING
    },
    distance: 0
  };
  if (startEvent) {
    startEvent.marked = true;
    startEvent.dist = 0;
  }
  if (parentGroup !== undefined) {
    group.anchor.x = parentGroup.anchor.x + PADDING
    group.anchor.y = parentGroup.anchor.y + PADDING
  }

  if (parentGroup !== undefined) {
    group.anchor.x = parentGroup.anchor.x + PADDING
    group.anchor.y = parentGroup.anchor.y + PADDING
  }

  // queue holds visited elements
  var queue = startEvent ? [startEvent] : []

  var elementOrConnection,
      outgoings;

  while (queue.length !== 0) {
      // get first
      elementOrConnection = queue.shift();
      // insert element into group
      group = this._groupElement(elementOrConnection, group, rootDi);
      if (elementOrConnection.$type === 'bpmn:SubProcess') {
        this._breadFirstSearch(elementOrConnection, rootDi, group);
        this._layoutGroup(group, rootDi);
      }
      if(elementOrConnection.$type !== 'bpmn:SequenceFlow') {
        // only if source is an element
        outgoings = getOutgoingConnection(elementOrConnection, children);
        if (outgoings.length) {
          outgoings.forEach(function(connection) {

            // for layouting the connection
            if (!connection.marked) {
              connection.marked = true;
              connection.dist = elementOrConnection.dist + 1;
              queue.push(connection);
            }

            var target = connection.get('targetRef');
            if (!target.marked) {
              target.marked = true;
              target.dist =  elementOrConnection.dist + 1;
              queue.push(target);
            }
          });
        }
      }
  }
  if (elementOrConnection && elementOrConnection.$type !== 'bpmn:SubProcess') {
    this._layoutGroup(group, rootDi);
  }
};

AutoLayout.prototype._groupElement = function(elementOrConnection, group, parentDi) {
  if (elementOrConnection.dist === group.distance) {
    if (elementOrConnection.$type === 'bpmn:SequenceFlow') {
      group.connections.push(elementOrConnection);
    }
    else {
      group.elements.push(elementOrConnection);
    }
  } else {
    var newAnchor = this._layoutGroup(group, parentDi);
    group = {
      elements: elementOrConnection.$type === 'bpmn:SequenceFlow' ? [] : [elementOrConnection],
      connections: elementOrConnection.$type === 'bpmn:SequenceFlow' ? [elementOrConnection] : [],
      anchor: newAnchor,
      distance: elementOrConnection.dist
    };
  }
  return group;
};

AutoLayout.prototype._layoutGroup = function(group, parentDi) {
  var newAnchor = this._layoutElements(group, parentDi)
  this._layoutConnections(group, parentDi);
  return newAnchor;
};

AutoLayout.prototype._layoutElements = function(group, parentDi) {
  var createDi = this.DiFactory.createBpmnElementDi.bind(this.DiFactory);
  var getDefaultSize = this.DiFactory._getDefaultSize.bind(this.DiFactory);

  const breadFirstSearch = this._breadFirstSearch.bind(this)

  var elements = group.elements
  var anchor = group.anchor;

  var bottom
  var top;

  top = anchor.y;
  bottom = top
  var childrenDi = parentDi.get('planeElement');
  var elementDi;

  var pos = {
    x: anchor.x,
    y: anchor.y
  };

  var size,
      height,
      width;
  var maxWidth = 0;

  elements.forEach(function(element, index) {
    // check for existing DI element
    const found = childrenDi.find(childDi => {
      return childDi.id.includes(element.id)
    })
    size = getDefaultSize(element);
    height = size.height;
    maxWidth = Math.max(maxWidth, size.width);
    if (index === 0) {
      if (elements.length === 1) {
        bottom += (height / 2) + STDDIST
        top -= height / 2;
      } else {
        bottom += height + STDDIST
      }
      pos.y = top;
    } else {
      if((anchor.y - top) < (bottom - anchor.y)) {
        // move to top
        top -= (STDDIST + height);
        pos.y = top;
      } else {
        // move to bottom
        pos.y = bottom;
        bottom += (STDDIST + height);
      }
    }
    element.bounds = Object.assign({}, size, pos);
    elementDi = createDi('shape', element, pos);
    if (found) {
      // replace exisiting with latest
      childrenDi.splice(childrenDi.indexOf(found), 1, elementDi)
    } else {
      childrenDi.push(elementDi);
    }
    if (element.flowElements && element.$type === 'bpmn:SubProcess') {
      // element repositioned ... redraw children
      element.flowElements.forEach(el => el.marked = false)
      let subgroup = {
        elements: element.flowElements,
        connections: [],
        anchor: {
          x: pos.x,
          y: pos.y + (height / 2) - (PADDING / 2)
        }
      }
      breadFirstSearch(element, parentDi, subgroup);
    }
  });
  return {
    x: anchor.x + maxWidth + (2 * STDDIST),
    y: anchor.y
  };
};

AutoLayout.prototype._layoutConnections = function(group, parentDi) {
  var createDi = this.DiFactory.createBpmnElementDi.bind(this.DiFactory);
  var childrenDi = parentDi.get('planeElement');
  var connections = group.connections;
  connections.forEach(function(connection) {
    // check for existing DI element
    const found = childrenDi.find(childDi => {
      return childDi.id.includes(connection.id)
    })
    var connectionDi = createDi('connection', connection);
    if (found) {
      // replace exisiting with latest
      childrenDi.splice(childrenDi.indexOf(found), 1, connectionDi)
    } else {
      childrenDi.push(connectionDi);
    }
  });
};


/////// helpers //////////////////////////////////

function getStartEvent(flowElements) {
  return flowElements.filter(function(e) {
    return e.$type === 'bpmn:StartEvent';
  })[0];
}

function getOutgoingConnection(source, flowElements) {
  return flowElements.filter(function(e) {
    return e.$type === 'bpmn:SequenceFlow' && e.get('sourceRef').id === source.id;
  });
}

function getIncomingConnection(target, flowelements) {
  return connections.filter(function(c) {
    return c.$type === 'bpmn:SequenceFlow' && c.get('targetRef').id === target.id
  });
}
