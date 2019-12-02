var BpmnModdle = require('bpmn-moddle');
var Tree = require('./Tree');
var DiFactory = require('./DiFactory');

var DiUtil = require('./DiUtil');

var is = DiUtil.is;
var getExpandedBounds = DiUtil.getExpandedBounds;
var getBendpoints = DiUtil.getBendpoints;

var PADDING_NODE = 'padding_node';


function AutoLayout() {
  this.moddle = new BpmnModdle();
  this.DiFactory = new DiFactory(this.moddle);
  this.nodeCount = -1;
}

module.exports = AutoLayout;

AutoLayout.prototype.layoutProcess = function(xmlStr, callback) {
  var self = this;
  var moddle = this.moddle;
  var createDiPlane = this.DiFactory.createDiPlane.bind(this.DiFactory);
  var createDiDiagram = this.DiFactory.createDiDiagram.bind(this.DiFactory);

  return new Promise(function(resolve, reject) {

    moddle.fromXML(xmlStr, function(error, moddleWithoutDi) {
      if (error) {
        return reject(error);
      }

      // create new di section
      var root = moddleWithoutDi.get('rootElements').find(el => el.$type === 'bpmn:Process');
      var rootDi = createDiPlane({
        id: 'BPMNPlane_1',
        bpmnElement: root
      });
      var newDiagram = createDiDiagram({
        id: 'BPMNDiagram_1',
        plane: rootDi
      });
      moddleWithoutDi.diagrams = [newDiagram];

      // build the tree layout
      self.tree = new Tree('Process');
      self._addTreeNode(root, root.flowElements);
      self._buildTreeBreadFirstSearch(root);
      console.log('tree built');
      self.tree.UpdateTree();
      console.log('tree updated');

      // create di
      self._layoutTreeBreadFirstSearch(root, rootDi);
      console.log('bpmn element layout complete');

      moddle.toXML(moddleWithoutDi, function(err, result) {

        if (err) {
          return reject(err);
        }

        return resolve(result);
      });
    });
  });

};

AutoLayout.prototype._buildTreeBreadFirstSearch = function(rootFlowElement) {
  var self = this;
  var children = rootFlowElement.flowElements;

  // queue holds visited elements
  var queue = children ? [...children] : [];
  var elementOrConnection;
  var outgoings;
  while (queue.length !== 0) {

    // get first
    elementOrConnection = queue.shift();
    if (elementOrConnection.$type !== 'bpmn:SequenceFlow' &&
        elementOrConnection.$type !== 'bpmn:SubProcess') {

      // add this node to the tree
      self._addTreeNode(elementOrConnection, children);
    }
    if (elementOrConnection.$type === 'bpmn:SubProcess') {
      self._explodeSubprocess(elementOrConnection, children);
    }
    if (elementOrConnection.$type !== 'bpmn:SequenceFlow') {

      // only if source is an element
      outgoings = getOutgoingConnection(elementOrConnection, children);
      if (outgoings.length) {
        outgoings.forEach(function(connection) {

          // for layouting the connection
          if (!connection.build_marked) {
            connection.build_marked = true;
            queue.push(connection);
          }
          var target = connection.get('targetRef');
          if (!target.build_marked) {
            self._addTreeNode(target, children);
            queue.push(target);
          }
        });
      }
    }
  }
};

AutoLayout.prototype._explodeSubprocess = function(flowElement, flowElements) {

  // this element is a subprocess, append the subprocess node to the tree,
  // then append the subprocess child elements to the subprocess node,
  // then add the subprocess element children to the subprocess end node
  /*
    Before (Bpmn):
      Process:
        [start] --- [ subprocess_01 ] --- [end]
      subprocess_01:
        [sub_start] --- [ task_01 ] --- [sub_end]

    After (Tree Nodes):
      [start] --- [ subprocess_01 ] --- [sub_start] --- [ task_01] --- [sub_end] --- [end]
  */
  // the idea is that the subprocess node will be positioned correctly within the overall tree
  // and the rest of the tree will respect the sub processes elements.
  // we'd just need to tweak the 'offsets' caused by the subprocess tree node when drawing

  var self = this;
  var subprocessNode = self._addTreeNode(flowElement, flowElements);
  self._buildTreeBreadFirstSearch(flowElement);
  if (flowElement.flowElements) {
    var subprocessStartEvents = getStartEvents(flowElement.flowElements);
    var subprocessStartNodes = subprocessStartEvents.map(startEvent => {
      var startNode = self.tree.getNodeByName(startEvent.id);
      return startNode;
    });
    var subprocessEndEvents = getEndEvents(flowElement.flowElements);
    var subprocessEndNode = subprocessEndEvents.map(endEvent => {
      return self.tree.getNodeByName(endEvent.id);
    })[0]; // assume only one end node
    // set the children of the subprocessNode as the children of the subprocessEndNode
    var outgoing = getOutgoingConnection(flowElement, flowElements);
    if (outgoing.length) {
      outgoing.forEach(function(connection) {
        var source = connection.get('targetRef');
        let child;
        if (source.build_marked) {
          child = self.tree.getNodeByName(source.id);
        } else {
          child = self._addTreeNode(source, flowElements);
        }
        self.tree.addParentToNode(child.id, subprocessNode.id);
      });
    }
    var childNodes = [...subprocessNode.children].filter(child => {
      return !subprocessStartNodes.find(startNode => startNode.id === child.id);
    });
    childNodes.forEach(childNode => {
      this.tree.addParentToNode(childNode.id, subprocessEndNode.id);
      self._balanceTreeNodeParentLevels(childNode);
    });

    // remove children from subprocess node
    subprocessNode.children.forEach(childNode => {
      this.tree.removeParentFromNode(childNode.id, subprocessNode.id);
    });

    // remove parents from subprocessStartNodes
    subprocessStartNodes.forEach(subprocessStartNode => {
      var parents = [...subprocessStartNode.parents];
      parents.forEach(parentNode => {
        this.tree.removeParentFromNode(subprocessStartNode.id, parentNode.id);
      });
    });

    // set the subprocessStartNodes as the children of the subprocessNode
    subprocessStartNodes.forEach(subprocessStartNode => {
      this.tree.addParentToNode(subprocessStartNode.id, subprocessNode.id);
      self._balanceTreeNodeParentLevels(subprocessStartNode);
    });
  }
};

AutoLayout.prototype._addTreeNode = function(flowElement, flowElements) {
  var getDefaultSize = this.DiFactory._getDefaultSize.bind(this.DiFactory);
  var self = this;
  let node;
  if (!flowElement.build_marked) {

    // add the node
    flowElement.build_marked = true;
    var parentNodes = [];

    // get parents
    var incoming = getIncomingConnection(flowElement, flowElements);
    if (incoming.length) {
      incoming.forEach(function(connection) {
        var source = connection.get('sourceRef');
        let parent;
        if (source.$type !== 'bpmn:SubProcess') {
          if (source.build_marked) {
            parent = self.tree.getNodeByName(source.id);
          } else {
            parent = self._addTreeNode(source, flowElements);
          }
        } else {

          // subprocesses are be handled elsewhere
          var subprocessEndEvents = getEndEvents(source.flowElements);
          var subprocessEnd = subprocessEndEvents[0]; // assume only one end elements
          if (subprocessEnd && subprocessEnd.build_marked) {
            parent = self.tree.getNodeByName(subprocessEnd.id);
          }
        }
        if (parent) {
          parentNodes.push(parent);
        }
      });
    }
    var size = getDefaultSize(flowElement);
    node = this.tree.add(this.nodeCount, flowElement.id, size.width, size.height);
    this.nodeCount += 1;
    if (parentNodes.length === 0) {

      // root
      this.tree.addParentToNode(node.id, -1);
    } else {
      parentNodes.forEach(parentNode => this.tree.addParentToNode(node.id, parentNode.id));
    }
    console.log('Added ' + node.dsc + ' as Node ' + this.nodeCount);
    self._balanceTreeNodeParentLevels(node);
    flowElement.nodeId = node.id;
    return node;
  } else {

    // find and return the node
    return self.tree.getNodeByName(flowElement.id);
  }
};

AutoLayout.prototype._balanceTreeNodeParentLevels = function(node) {
  var self = this;
  var maxParentLevel = node._getLevel() - 1;

  // pad out levels such that node parents are at same level
  var oldParents = [...node.parents];
  oldParents.forEach(parent => {
    let padParent = parent;
    while (padParent._getLevel() < maxParentLevel) {
      var oldParent = padParent;
      self.tree.removeParentFromNode(node.id, oldParent.id);
      padParent = self.tree.add(this.nodeCount, PADDING_NODE, 100, 1);

      // console messaging
      var message = 'Added ' + PADDING_NODE + padParent.id + ' between ' +
      oldParent.dsc + (oldParent.dsc === PADDING_NODE ? oldParent.id : '') + ' and ' +
      node.dsc + (node.dsc === PADDING_NODE ? node.id : '');
      console.log(message);

      // sort out parents
      this.nodeCount += 1;
      self.tree.addParentToNode(node.id, padParent.id);
      self.tree.addParentToNode(padParent.id, oldParent.id);
    }
  });
};

AutoLayout.prototype._layoutTreeBreadFirstSearch = function(parentFlowElement, rootDi) {
  var children = parentFlowElement.flowElements;
  var startEvents = children && getStartEvents(children);

  // groups are elements with the same distance
  var group = {
    elements: [],
    connections: [],
    distance: 0
  };
  if (startEvents) {
    startEvents.forEach(startEvent => {
      startEvent.marked = true;
      startEvent.dist = 0;
    });
  }

  // queue holds visited elements
  var queue = startEvents ? [...startEvents] : [];
  var elementOrConnection;
  var outgoings;
  while (queue.length !== 0) {

    // get first
    elementOrConnection = queue.shift();

    // insert element into group
    group = this._groupElement(elementOrConnection, group, rootDi);
    group.offsets = parentFlowElement.offsets;
    if (elementOrConnection.$type === 'bpmn:SubProcess') {
      this._layoutTreeBreadFirstSearch(elementOrConnection, rootDi);
    }
    if (elementOrConnection.$type !== 'bpmn:SequenceFlow') {

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
            target.dist = elementOrConnection.dist + 1;
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
    } else {
      group.elements.push(elementOrConnection);
    }
  } else {
    this._layoutGroup(group, parentDi);
    group = {
      elements: elementOrConnection.$type === 'bpmn:SequenceFlow' ? [] : [elementOrConnection],
      connections: elementOrConnection.$type === 'bpmn:SequenceFlow' ? [elementOrConnection] : [],
      distance: elementOrConnection.dist
    };
  }
  return group;
};

AutoLayout.prototype._layoutGroup = function(group, parentDi) {
  this._layoutElements(group, parentDi);
  this._layoutConnections(group, parentDi);
};

AutoLayout.prototype._layoutElements = function(group, parentDi) {
  var self = this;
  var createDi = this.DiFactory.createBpmnElementDi.bind(this.DiFactory);
  var getDefaultSize = this.DiFactory._getDefaultSize.bind(this.DiFactory);
  var _layoutTreeBreadFirstSearch = this._layoutTreeBreadFirstSearch.bind(this);
  var elements = group.elements;
  var childrenDi = parentDi.get('planeElement');
  var elementDi;
  var pos = {};
  var size;
  var offsets = (group && group.offsets) || { x: 0, y: 0 };
  elements.forEach(function(element) {

    // check for existing DI element
    var found = childrenDi.find(childDi => {
      return childDi.id.includes(element.id);
    });
    size = getDefaultSize(element);
    var treeNode = self.tree.getNodeById(element.nodeId);
    if (treeNode) {
      pos.x = treeNode.XPosition + offsets.x;
      pos.y = treeNode.YPosition + offsets.y;
    }
    element.bounds = Object.assign({}, size, pos);
    elementDi = createDi('shape', element, pos);
    if (found) {

      // replace exisiting with latest
      childrenDi.splice(childrenDi.indexOf(found), 1, elementDi);
    } else {
      childrenDi.push(elementDi);
    }
    if (element.flowElements && element.$type === 'bpmn:SubProcess') {
      var bounds = getExpandedBounds(element);
      element.flowElements.forEach(el => { el.marked = false; });
      var offsetX = (element.bounds.x + element.bounds.width / 2) - (bounds.x + bounds.width / 2);
      var offsetY = (element.bounds.y + element.bounds.height / 2) - (bounds.y + bounds.height / 2);
      element.offsets = {
        x: offsetX + offsets.x,
        y: offsetY
      };
      _layoutTreeBreadFirstSearch(element, parentDi);
    }
  });
};

AutoLayout.prototype._layoutConnections = function(group, parentDi) {
  var self = this;
  var createDi = this.DiFactory.createBpmnElementDi.bind(this.DiFactory);
  var createDiWaypoint = this.DiFactory.createDiWaypoint.bind(this.DiFactory);
  var childrenDi = parentDi.get('planeElement');
  var connections = group.connections;
  connections.forEach(function(connection) {

    // check for existing DI element
    var found = childrenDi.find(childDi => {
      return childDi.id.includes(connection.id);
    });
    var connectionDi = createDi('connection', connection);
    var sourceRef = connection.get('sourceRef');
    var targetRef = connection.get('targetRef');
    var sourceNode = self.tree.getNodeByName(sourceRef.id);
    var directTarget = is(sourceRef.$type, 'bpmn:SubProcess');
    if (!directTarget && sourceNode && sourceNode.children && sourceNode.children.length > 0) {
      sourceNode.children.forEach(function(node) {
        if (node.dsc === targetRef.id) {
          directTarget = true;
        }
      });
    }
    if (sourceNode && sourceNode.children && sourceNode.children.length > 0 && !directTarget) {

      // this connection needs to accommodate padding nodes
      // check for any padding nodes and go through those coords
      var oldPoints = connectionDi.waypoint;
      var newPoints = [oldPoints[0]];

      // get node for sourceRef
      var pathNodes = getPathToTarget(sourceNode, targetRef.id);
      pathNodes.pop();
      if (is(sourceRef.$type, 'bpmn:Gateway')) {
        var start = oldPoints[0];
        var first = {
          x: pathNodes[1].XPosition + (group.offsets ? group.offsets.x : 0),
          y: pathNodes[1].YPosition + (group.offsets ? group.offsets.y : 0)
        };
        getBendpoints(start, first, 'h:h').forEach(bendpoint => {

          // console.log( `x: ${bendpoint.x}, y: ${bendpoint.y} - bend`)
          newPoints.push(createDiWaypoint(bendpoint));
        });
        pathNodes.shift();
      }
      pathNodes.shift();
      var points = [];
      pathNodes.forEach(pathNode => {

        // console.log( `x: ${pathNode.XPosition}, y: ${pathNode.YPosition}`)
        points.push({
          x: pathNode.XPosition + (group.offsets ? group.offsets.x : 0),
          y: pathNode.YPosition + (group.offsets ? group.offsets.y : 0)
        });
      });
      var lastPoint = oldPoints[oldPoints.length - 1];
      if (points.length > 0) {
        points.forEach(point => {
          newPoints.push(createDiWaypoint(point));
        });
        var directions = 'h:v';
        getBendpoints(points[points.length - 1], lastPoint, directions).forEach(bendpoint => {
          newPoints.push(createDiWaypoint(bendpoint));
        });
      }
      newPoints.push(lastPoint);
      connectionDi.waypoint = newPoints;
    }
    if (found) {

      // replace exisiting with latest
      childrenDi.splice(childrenDi.indexOf(found), 1, connectionDi);
    } else {
      childrenDi.push(connectionDi);
    }
  });
};

function getPathToTarget(sourceNode, targetId) {
  if (sourceNode === undefined) {
    return undefined;
  }
  if (sourceNode.dsc === targetId) {
    return [sourceNode];
  }
  if (sourceNode.children) {
    let pathToTarget;
    sourceNode.children.forEach(source => {
      if (source.dsc === PADDING_NODE || source.dsc === targetId) {
        var path = getPathToTarget(source, targetId);
        if (path) {
          pathToTarget = path;
        }
      }
    });
    if (pathToTarget) {
      return [sourceNode, ...pathToTarget];
    }
  }
  return undefined;
}

function getStartEvents(flowElements) {
  return flowElements ? flowElements.filter(e => {
    return is(e.$type, 'bpmn:StartEvent');
  }) : [];
}

function getEndEvents(flowElements) {
  return flowElements ? flowElements.filter(e => {
    return is(e.$type, 'bpmn:EndEvent');
  }) : [];
}

function getOutgoingConnection(source, flowElements) {
  return flowElements ? flowElements.filter(e => {
    return is(e.$type, 'bpmn:SequenceFlow') && e.get('sourceRef').id === source.id;
  }) : [];
}

function getIncomingConnection(target, flowElements) {
  return flowElements ? flowElements.filter(e => {
    return is(e.$type, 'bpmn:SequenceFlow') && e.get('targetRef').id === target.id;
  }) : [];
}
