import { connectElements } from '../utils/layoutUtil.js';
import { sortByInstance, findMergingStartingPosition, findSplittingStartingPosition } from '../utils/elementUtils.js';

export default {
  'addToGrid': ({ element, grid, stack, visited, skipped, force }) => {
    const nextElements = [];

    console.log('visiting');
    console.log(element);

    // Handle outgoing paths
    let outgoing = (element.outgoing || [])
      .map(out => out.targetRef)
      .filter(el => el);

    outgoing = sortByInstance(outgoing, 'bpmn:Task');
    outgoing = sortByInstance(outgoing, 'bpmn:Gateway');
    outgoing = sortByInstance(outgoing, 'bpmn:EndEvent');

    outgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }

      const nextIncoming = (nextElement.incoming || [])
        .map(out => out.sourceRef)
        .filter(el => el);


      const nextOutgoing = (nextElement.outgoing || [])
        .map(out => out.targetRef)
        .filter(el => el);

      const isMerging = nextIncoming.length > 1;
      const skipThis = isMerging && !nextIncoming.every(el => visited.has(el));

      const isSplitting = nextOutgoing.length > 1;

      if ((skipThis || isSplitting) && !force && !stack.indexOf(element) !== -1 && !skipped.indexOf(element) !== -1) {
        skipped.push(element);
        return;
      }

      console.log('adding');
      console.log(nextElement);

      if (isMerging) {
        console.log('to row');
        grid.addToNextEmptyRowAndColumn(findMergingStartingPosition(grid, nextIncoming), nextElement, 0);
      } else if (isSplitting) {
        console.log('to column');
        grid.addToNextEmptyColumn(grid.find(element), nextElement);
      } else {
        console.log('after');
        console.log(index);
        grid.addToNextEmptyRow(grid.find(element), nextElement, index);
      }

      nextElements.unshift(nextElement);
      visited.add(nextElement);
      force = false;
    });

    // Handle incoming paths
    let incoming = (element.incoming || [])
      .map(out =>
      {
        if (out.sourceRef.$type == 'bpmn:BoundaryEvent') {
          return out.sourceRef.attachedToRef;
        } else {
          return out.sourceRef;
        }
      })
      .filter(el => el);

    incoming = sortByInstance(incoming, 'bpmn:Task');
    incoming = sortByInstance(incoming, 'bpmn:Gateway');

    incoming.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }

      // const nextIncoming = (nextElement.incoming || [])
      //   .map(out => out.sourceRef)
      //   .filter(el => el);


      let nextOutgoing = [
        ...(nextElement.outgoing || []).map(out => out.targetRef)
          .filter(el => el),
        ...(nextElement.attachers || [])
          .map(att => att.outgoing.reverse())
          .flat()
          .map(out => out.targetRef)
      ];

      console.log('nextOutgoing');
      nextOutgoing.forEach(el => console.log(el));

      const isCurrentMerging = incoming.length > 1;
      const isSplitting = nextOutgoing.length > 1;

      const skipThis = isSplitting && !nextOutgoing.every(el => visited.has(el));

      if ((skipThis || isCurrentMerging) && !force && !stack.indexOf(element) !== -1 && !skipped.indexOf(element) !== -1) {
        console.log('skip this');
        console.log(isCurrentMerging);
        console.log(isSplitting);
        console.log(!nextOutgoing.every(el => visited.has(el)));
        skipped.push(element);
        return;
      }

      console.log('adding');
      console.log(nextElement);

      if (isSplitting) {
        console.log('to column');
        grid.addToPreviousEmptyColumn(findSplittingStartingPosition(grid, nextOutgoing), nextElement);
      } else if (isCurrentMerging) {
        console.log('to row');
        grid.addToPreviousEmptyRow(grid.find(element), nextElement, 0);
      } else {
        console.log('before');
        console.log(index);
        grid.addToPreviousEmptyRow(grid.find(element), nextElement, index);
      }

      nextElements.unshift(nextElement);
      visited.add(nextElement);
      force = false;
    });

    return nextElements;
  },
  'createConnectionDi': ({ element, row, col, layoutGrid, diFactory }) => {
    const outgoing = element.outgoing || [];

    return outgoing.map(out => {
      const target = out.targetRef;
      console.log(target);
      const waypoints = connectElements(element, target, layoutGrid);

      const connectionDi = diFactory.createDiEdge(out, waypoints, {
        id: out.id + '_di'
      });

      return connectionDi;
    });

  }
};