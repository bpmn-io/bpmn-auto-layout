var BpmnModdle = require('bpmn-moddle'),
    DiFactory = require('./DiFactory');

var filter = require('lodash/collection/filter'),
    assign = require('lodash/object/assign');

var emptyDi = '<bpmndi:BPMNDiagram id="BPMNDiagram_1">' +
                '<bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">' +
                '</bpmndi:BPMNPlane>' +
              '</bpmndi:BPMNDiagram>' +
            '</bpmn:definitions>';

var STDDIST = 50;

function AutoLayout() {
  this.moddle = new BpmnModdle();
  this.DiFactory = new DiFactory(this.moddle);
}

module.exports = AutoLayout;

AutoLayout.prototype.layoutProcess = function(xmlStr) {

  var self = this;
  var moddle = this.moddle;

  // create empty di section
  // TODO generate this section dynamically
  xmlStr = xmlStr.replace('</bpmn:definitions>', emptyDi);

  moddle.fromXML(xmlStr, function(err, moddleWithoutDi) {

    var root = moddleWithoutDi.get('rootElements')[0];
    var rootDi = moddleWithoutDi.get('diagrams')[0].get('plane');

    // create di
    self._breadFirstSearch(root, rootDi);

    moddle.toXML(moddleWithoutDi, function(err, xmlWithDi) {
      console.log(xmlWithDi);
    });

  });
};


AutoLayout.prototype._breadFirstSearch = function (parentFlowElement, parentDi) {

  var children = parentFlowElement.flowElements;

  var startEvent = getStartEvent(children);

  // groups are elements with the same distance
  var group = {
    elements: [],
    connections: [],
    anchor: {
      x: 100,
      // 100 + mid of startEvent
      y: 100 + 36 / 2
    },
    distance: 0
  };

  startEvent.marked = true;
  startEvent.dist = 0;

  // queue holds visited elements
  var queue = [startEvent];

  var elementOrConnection,
      outgoings;

  while (queue.length !== 0) {

      // get first
      elementOrConnection = queue.shift();

      // insert element into group
      group = this._groupElement(elementOrConnection, group, parentDi);

      if(elementOrConnection.$type !== 'bpmn:SequenceFlow'){
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

  this._layoutGroup(group, parentDi);
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

  var connections = group.connections;

  this._layoutConnections(connections, parentDi);

  return newAnchor;

};

AutoLayout.prototype._layoutElements = function(group, parentDi) {

  var createDi = this.DiFactory.createBpmnElementDi.bind(this.DiFactory);
  var getDefaultSize = this.DiFactory._getDefaultSize.bind(this.DiFactory);

  var elements = group.elements,
      anchor = group.anchor;

  var bottom,
      top;

  bottom = top = anchor.y;
  var childrenDi = parentDi.get('planeElement'),
      elementDi;

  var pos = {
    x: anchor.x
  };

  var size,
      height,
      width;
  var maxWidth = 0;

  elements.forEach(function(element) {

    size = getDefaultSize(element.$type);
    height = size.height;
    maxWidth = Math.max(maxWidth, size.width);

    if(top === bottom) {
      bottom += height / 2;
      top -= height / 2;
      pos.y = top;
    } else {
      if((anchor.y - top) < (bottom - anchor.y)) {
        // move to top
        top -= (height + STDDIST);
        pos.y = top;
      }
      else {
        // move to bottom
        bottom += STDDIST + height
        pos.y = bottom;
      }
    }
    element.bounds = assign({}, pos, size);
    elementDi = createDi('shape', element, pos);
    childrenDi.push(elementDi);
  });

  return { x: anchor.x + maxWidth + 2*STDDIST, y: anchor.y };
};

AutoLayout.prototype._layoutConnections = function(connections, parentDi) {

var createDi = this.DiFactory.createBpmnElementDi.bind(this.DiFactory);
  var childrenDi = parentDi.get('planeElement');
  connections.forEach(function(connection) {
    var connectionDi = createDi('connection', connection);
    childrenDi.push(connectionDi);
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
