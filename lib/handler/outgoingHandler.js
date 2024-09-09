import { connectElements } from '../utils/layoutUtil.js';
import { is } from '../di/DiUtil.js';

export default {
  'addToGrid': ({ element, grid, visited }) => {
    const nextElements = [];

    // Handle outgoing paths
    const outgoing = (element.outgoing || [])
      .map(out => out.targetRef)
      .filter(el => el);

    let previousElement = null;
    outgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }

      if (!previousElement) {
        grid.addAfter(element, nextElement);
      }
      else if (is(element, 'bpmn:ExclusiveGateway')) {
        grid.addAfter(previousElement, nextElement);
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