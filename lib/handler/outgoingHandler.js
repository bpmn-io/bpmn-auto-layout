import { connectElements } from '../utils/layoutUtil.js';
import { is } from '../di/DiUtil.js';
import { findElementInTree } from '../utils/elementUtils.js';


export default {
  'addToGrid': ({ element, grid, visited, stack }) => {
    let nextElements = [];

    // Handle outgoing paths
    const outgoing = (element.outgoing || [])
      .map(out => out.targetRef)
      .filter(el => el);

    let previousElement = null;

    if (outgoing.length > 1 && isNextElementTasks(outgoing)) {
      grid.adjustGridPosition(element);
    }

    outgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }

      // Prevents revisiting future incoming elements and ensures proper traversal without early exit.
      if ((previousElement || stack.length > 0) && isFutureIncoming(nextElement, visited) && !checkForLoop(nextElement, visited)) {
        return;
      }

      if (!previousElement) {
        grid.addAfter(element, nextElement);
      }

      else if (is(element, 'bpmn:ExclusiveGateway') && is(nextElement, 'bpmn:ExclusiveGateway')) {
        grid.addBelow(previousElement, nextElement);
      }
      else {
        grid.addBelow(arr[index - 1], nextElement);
      }

      // Is self-looping
      if (nextElement !== element) {
        previousElement = nextElement;
      }

      nextElements.unshift(nextElement);
      visited.add(nextElement);
    });

    // Sort elements by priority to ensure proper stack placement
    nextElements = sortByType(nextElements, 'bpmn:ExclusiveGateway'); // TODO: sort by priority
    return nextElements;
  },

  'createConnectionDi': ({ element, row, col, layoutGrid, diFactory }) => {
    const outgoing = element.outgoing || [];

    return outgoing.map(out => {
      const target = out.targetRef;
      const waypoints = connectElements(element, target, layoutGrid);

      const connectionDi = diFactory.createDiEdge(out, waypoints, {
        id: out.id + '_di'
      });

      return connectionDi;
    });

  }
};


// helpers /////

function sortByType(arr, type) {
  const nonMatching = arr.filter(item => !is(item,type));
  const matching = arr.filter(item => is(item,type));

  return [ ...matching, ...nonMatching ];

}

function checkForLoop(element, visited) {
  for (const incomingElement of element.incoming) {
    if (!visited.has(incomingElement.sourceRef)) {
      return findElementInTree(element, incomingElement.sourceRef);
    }
  }
}


function isFutureIncoming(element, visited) {
  if (element.incoming.length > 1) {
    for (const incomingElement of element.incoming) {
      if (!visited.has(incomingElement.sourceRef)) {
        return true;
      }
    }
  }
  return false;
}

function isNextElementTasks(elements) {
  return elements.every(element => is(element, 'bpmn:Task'));
}