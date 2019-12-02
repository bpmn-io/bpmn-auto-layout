/*
  This tree is a version of ECOTree.js (by Emilio Cortegoso Lobato), with modifications.
  These modifications include:
    - supporting multiple parents
    - removed all node styling code
    - removed tree orientation code in favour of left to right orientation
  References:
    - ECOTree.js, Emilio Cortegoso Lobato
    - "A Node-Positioning Algorithm for General Trees", Walker II, J. Q.
*/

function TreeNode(id, dsc, w, h) {
  this.id = id;
  this.dsc = dsc;
  this.w = w;
  this.h = h;
  this.dbIndex = 0;
  this.XPosition = 0;
  this.YPosition = 0;
  this.prelim = 0;
  this.modifier = 0;
  this.leftNeighbor = null;
  this.rightNeighbor = null;
  this.parents = [];
  this.children = [];
}

TreeNode.prototype._getLevel = function() {
  if (this.id === -1 || this.parents === undefined || this.parents.length === 0) {
    return 0;
  } else {
    let maxLevel = 0;
    this.parents.forEach(parent => {
      var parentLevel = parent._getLevel();
      maxLevel = (maxLevel < parentLevel) ? parentLevel : maxLevel;
    });
    return maxLevel + 1;
  }
};

TreeNode.prototype._getChildrenCount = function() {
  return this.children ? this.children.length : 0;
};

TreeNode.prototype._getLeftSibling = function() {
  if (!this.leftNeighbor) {
    return null;
  }
  var haveSameParent = this.leftNeighbor.parents.find(lParent => {
    return this.parents.find(tParent => tParent.id === lParent.id);
  });
  return haveSameParent ? this.leftNeighbor : null;
};

TreeNode.prototype._getRightSibling = function() {
  if (!this.rightNeighbor) {
    return null;
  }
  var haveSameParent = this.rightNeighbor.parents.find(rParent => {
    return this.parents.find(tParent => tParent.id === rParent.id);
  });
  return haveSameParent ? this.rightNeighbor : null;
};

TreeNode.prototype._getChildAt = function(i) {
  return this.children[i];
};

TreeNode.prototype._getChildrenCenter = function(tree) {
  var first = this._getFirstChild();
  var last = this._getLastChild();
  return first.prelim + ((last.prelim - first.prelim) + tree._getNodeSize(last)) / 2;
};

TreeNode.prototype._getFirstChild = function() {
  return this._getChildAt(0);
};

TreeNode.prototype._getLastChild = function() {
  return this._getChildAt(this._getChildrenCount() - 1);
};

function Tree() {
  this.config = {
    iMaxDepth: 1000,
    iLevelSeparation: 20,
    iSiblingSeparation: 20,
    iSubtreeSeparation: 60,
    topXAdjustment: 0,
    topYAdjustment: 0
  };
  this.self = this;
  this.maxLevelHeight = [];
  this.maxLevelWidth = [];
  this.previousLevelNode = [];
  this.rootYOffset = 0;
  this.rootXOffset = 0;
  this.nDatabaseNodes = [];
  this.mapIDs = {};
  this.root = new TreeNode(-1, null, null, 2, 2);
  this.iLastSearch = 0;
}

module.exports = Tree;

// Layout algorithm
Tree._firstWalk = function(tree, node, level, prevSiblings = []) {

  // console.log('_firstWalk()')
  var leftSibling = null;
  node.XPosition = 0;
  node.YPosition = 0;
  node.prelim = 0;
  node.modifier = 0;
  node.leftNeighbor = null;
  node.rightNeighbor = null;
  tree._setLevelHeight(node, level);
  tree._setLevelWidth(node, level);
  tree._setNeighbors(node, level);
  if (node._getChildrenCount() === 0 || level === tree.config.iMaxDepth) {
    leftSibling = node._getLeftSibling();
    if (leftSibling != null) {
      node.prelim = leftSibling.prelim + tree._getNodeSize(leftSibling) + tree.config.iSiblingSeparation;
    } else {
      node.prelim = 0;
    }
  } else {
    var n = node._getChildrenCount();
    for (var i = 0; i < n; i++) {
      var iChild = node._getChildAt(i);
      Tree._firstWalk(tree, iChild, level + 1, [...prevSiblings, iChild.id]);
    }
    var midPoint = node._getChildrenCenter(tree);
    midPoint -= tree._getNodeSize(node) / 2;
    leftSibling = node._getLeftSibling();
    if (leftSibling != null && !prevSiblings.includes(leftSibling.id)) {
      node.prelim = leftSibling.prelim + tree._getNodeSize(leftSibling) + tree.config.iSiblingSeparation;
      node.modifier = node.prelim - midPoint;
      Tree._apportion(tree, node, level);
    } else {
      node.prelim = midPoint;
    }
  }
};

Tree._apportion = function(tree, node, level) {

  // console.log('_apportion()')
  var firstChild = node._getFirstChild();
  var firstChildLeftNeighbor = firstChild.leftNeighbor;
  var j = 1;
  for (var k = tree.config.iMaxDepth - level; firstChild != null && firstChildLeftNeighbor != null && j <= k;) {
    var modifierSumRight = 0;
    var modifierSumLeft = 0;
    var rightAncestor = firstChild;
    var leftAncestor = firstChildLeftNeighbor;
    for (var l = 0; l < j; l++) {
      rightAncestor = rightAncestor.parents[0];
      leftAncestor = leftAncestor.parents[0];
      modifierSumRight += rightAncestor.modifier;
      modifierSumLeft += leftAncestor.modifier;
    }
    var totalGap = (firstChildLeftNeighbor.prelim + modifierSumLeft + tree._getNodeSize(firstChildLeftNeighbor) + tree.config.iSubtreeSeparation) - (firstChild.prelim + modifierSumRight);
    if (totalGap > 0) {
      var subtreeAux = node;
      var numSubtrees = 0;
      for (; subtreeAux != null && subtreeAux !== leftAncestor; subtreeAux = subtreeAux._getLeftSibling()) {
        numSubtrees++;
      }
      if (subtreeAux != null) {
        var subtreeMoveAux = node;
        var singleGap = totalGap / numSubtrees;
        for (; subtreeMoveAux !== leftAncestor; subtreeMoveAux = subtreeMoveAux._getLeftSibling()) {
          subtreeMoveAux.prelim += totalGap;
          subtreeMoveAux.modifier += totalGap;
          totalGap -= singleGap;
        }
      }
    }
    j++;
    if (firstChild._getChildrenCount() === 0) {
      firstChild = tree._getLeftmost(node, 0, j);
    } else {
      firstChild = firstChild._getFirstChild();
    }
    if (firstChild != null) {
      firstChildLeftNeighbor = firstChild.leftNeighbor;
    }
  }
};

Tree._secondWalk = function(tree, node, level, X, Y, prevSiblings = []) {

  // console.log('_secondWalk()')
  if (level <= tree.config.iMaxDepth) {
    var xTmp = tree.rootXOffset + node.prelim + X;
    var yTmp = tree.rootYOffset + Y;
    var maxsizeTmp = 0;
    var nodesizeTmp = 0;
    var flag = false;

    maxsizeTmp = tree.maxLevelWidth[level];
    flag = true;
    nodesizeTmp = node.w;

    node.XPosition = xTmp;
    node.YPosition = yTmp + (maxsizeTmp - nodesizeTmp) / 2;

    if (flag) {
      var swapTmp = node.XPosition;
      node.XPosition = node.YPosition;
      node.YPosition = swapTmp;
    }

    if (node._getChildrenCount() !== 0) {
      Tree._secondWalk(tree, node._getFirstChild(), level + 1, X + node.modifier, Y + maxsizeTmp + tree.config.iLevelSeparation, [...prevSiblings, node.id]);
    }
    var rightSibling = node._getRightSibling();
    if (rightSibling != null && !prevSiblings.includes(rightSibling.id)) { Tree._secondWalk(tree, rightSibling, level, X, Y, [...prevSiblings, node.id]); }
  }
};

Tree.prototype._positionTree = function() {

  // console.log('_positionTree()')
  this.maxLevelHeight = [];
  this.maxLevelWidth = [];
  this.previousLevelNode = [];
  Tree._firstWalk(this.self, this.root, 0);
  this.rootXOffset = this.config.topXAdjustment + this.root.XPosition;
  this.rootYOffset = this.config.topYAdjustment + this.root.YPosition;
  Tree._secondWalk(this.self, this.root, 0, 0, 0);
};

Tree.prototype._setLevelHeight = function(node, level) {
  if (this.maxLevelHeight[level] == null) { this.maxLevelHeight[level] = 0; }
  if (this.maxLevelHeight[level] < node.h) { this.maxLevelHeight[level] = node.h; }
};

Tree.prototype._setLevelWidth = function(node, level) {
  if (this.maxLevelWidth[level] == null) { this.maxLevelWidth[level] = 0; }
  if (this.maxLevelWidth[level] < node.w) { this.maxLevelWidth[level] = node.w; }
};

Tree.prototype._setNeighbors = function(node, level) {
  var tempNeighbour = this.previousLevelNode[level];
  if (tempNeighbour && tempNeighbour.id !== node.id) {
    node.leftNeighbor = this.previousLevelNode[level];
    if (node.leftNeighbor != null) {
      node.leftNeighbor.rightNeighbor = node;
    }
  }
  this.previousLevelNode[level] = node;
};

Tree.prototype._getNodeSize = function(node) {
  return node.h;
};

Tree.prototype._getLeftmost = function(node, level, maxlevel) {
  if (level >= maxlevel) return node;
  if (node._getChildrenCount() === 0) return null;

  var n = node._getChildrenCount();
  for (var i = 0; i < n; i++) {
    var iChild = node._getChildAt(i);
    var leftmostDescendant = this._getLeftmost(iChild, level + 1, maxlevel);
    if (leftmostDescendant != null) { return leftmostDescendant; }
  }

  return null;
};

Tree.prototype.UpdateTree = function() {
  this._positionTree();
};

Tree.prototype.add = function(id, dsc, w, h) {
  var node = new TreeNode(id, dsc, w, h);
  var i = this.nDatabaseNodes.length;
  node.dbIndex = this.mapIDs[id] = i;
  this.nDatabaseNodes[i] = node;
  return node;
};

Tree.prototype.addParentToNode = function(nodeId, parentId) {

  // retrieve nodes from list
  var node = this.getNodeById(nodeId);
  var parent = (parentId === -1) ? this.root : this.getNodeById(parentId);
  if (node === undefined) {
    throw new Error('Node not found');
  }
  if (parent === undefined) {
    throw new Error('Parent node not found');
  }

  // confirm this parents hasn't already been added to this node
  var found = node.parents.find(parent => parent.id === parentId);
  if (found === undefined) {
    node.parents.push(parent);

    // confirm that the child hasnt been added to the parents children list
    found = parent.children.find(child => child.id === nodeId);

    if (found === undefined) {
      parent.children.push(node);
    }
  }
};

Tree.prototype.removeParentFromNode = function(nodeId, parentId) {

  // retrieve nodes from list
  var node = this.getNodeById(nodeId);
  var parent = (parentId === -1) ? this.root : this.getNodeById(parentId);
  if (node === undefined) {
    throw new Error('Node not found');
  }
  if (parent === undefined) {
    throw new Error('Parent node not found');
  }

  // remove the parent node from node parents
  node.parents = node.parents.filter(parent => parent.id !== parentId);

  // remove the ndoe form the parent children list
  parent.children = parent.children.filter(child => child.id !== nodeId);
};

Tree.prototype.getNodeById = function(id) {
  return this.nDatabaseNodes.find(node => node.id === id);
};

Tree.prototype.getNodeByName = function(name) {
  return this.nDatabaseNodes.find(node => node.dsc === name);
};
