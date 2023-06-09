import { connectElements, getBounds } from '../utils/layoutUtil';

export default {
  'addToGrid': ({ element, grid, visited }) => {
    const nextElements = [];

    const attachedOutgoing = (element.attachers || [])
      .map(att => att.outgoing)
      .flat()
      .map(out => out.targetRef);

    // handle boundary events
    attachedOutgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }

      // Add below and to the right of the element
      insertIntoGrid(nextElement, element, grid);
      nextElements.push(nextElement);
    });

    return nextElements;
  },

  'createDi': ({ element, row, col, diFactory }) => {
    const DIs = [];
    (element.attachers || []).forEach(att => {
      att.gridPosition = { row, col };
      const attacherBounds = getBounds(att, row, col, element);

      const attacherDi = diFactory.createDiShape(att, attacherBounds, {
        id: att.id + '_di'
      });
      att.di = attacherDi;
      att.gridPosition = { row, col };

      DIs.push(attacherDi);
    });

    return DIs;
  },

  'createConnectionDi': ({ element, row, col, layoutGrid, diFactory }) => {

    const attachers = element.attachers || [];

    return attachers.flatMap(att => {
      const outgoing = att.outgoing || [];

      return outgoing.map(out => {
        const target = out.targetRef;
        const waypoints = connectElements(att, target, layoutGrid);

        const connectionDi = diFactory.createDiEdge(out, waypoints, {
          id: out.id + '_di'
        });

        return connectionDi;
      });
    });
  }
};


function insertIntoGrid(newElement, host, grid) {
  const [ row, col ] = grid.find(host);

  // Grid is occupied
  if (grid.get(row + 1, col) || grid.get(row + 1, col + 1)) {
    grid.createRow(row);
  }

  // Host has element directly after, add space
  if (grid.get(row, col + 1)) {
    grid.addAfter(host, null);
  }

  grid.add(newElement, [ row + 1, col + 1 ]);
}