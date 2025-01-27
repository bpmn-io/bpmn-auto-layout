import BPMNModdle from 'bpmn-moddle';
import {
  getAttachedOutgoingElements,
  getIncomingElements,
  getOutgoingElements,
  isBoundaryEvent,
  isConnection,
  isStartIntermediate
} from './utils/elementUtils.js';
import { Grid } from './Grid.js';
import { DiFactory } from './di/DiFactory.js';
import { is } from './di/DiUtil.js';
import { handlers } from './handler/index.js';
import { isFunction } from 'min-dash';

export class Layouter {
  constructor() {
    this.moddle = new BPMNModdle();
    this.diFactory = new DiFactory(this.moddle);
    this._handlers = handlers;
  }

  handle(operation, options) {
    return this._handlers
      .filter(handler => isFunction(handler[operation]))
      .map(handler => handler[operation](options));
  }

  async layoutProcess(xml) {
    const { rootElement } = await this.moddle.fromXML(xml);

    this.diagram = rootElement;

    const root = this.getProcess();

    if (root) {
      this.cleanDi();
      this.handlePlane(root);
    }

    return (await this.moddle.toXML(this.diagram, { format: true })).xml;
  }

  handlePlane(planeElement) {
    const layout = this.createGridLayout(planeElement);
    this.generateDi(planeElement, layout);
  }

  cleanDi() {
    this.diagram.diagrams = [];
  }

  createGridLayout(root) {
    const grid = new Grid();

    const flowElements = root.flowElements || [];
    const elements = flowElements.filter(el => !is(el,'bpmn:SequenceFlow'));

    // check for empty process/subprocess
    if (!flowElements) {
      return grid;
    }

    const boundaryEvents = flowElements.filter(el => isBoundaryEvent(el));
    boundaryEvents.forEach(boundaryEvent => {
      const attachedTask = boundaryEvent.attachedToRef;
      const attachers = attachedTask.attachers || [];
      attachers.push(boundaryEvent);
      attachedTask.attachers = attachers;
    });

    // Depth-first-search with reverse

    const elementsWithoutBoundary = elements.filter(el => !isBoundaryEvent(el));

    const visited = new Set();

    while (grid.getAllElements().length < elementsWithoutBoundary.length) {


      // maybe need boundaryEvents processing here
      const startingElementsOnly = flowElements.filter(el => {

        // work with elements are not in the grid
        const position = grid.find(el);
        if (!position) {
          return !isConnection(el) && !isBoundaryEvent(el) && (!el.incoming || el.length === 0) && !isStartIntermediate(el);
        }
      });

      const outgoingElementsInGrid = elementsWithoutBoundary.filter(el => {
        if (!isBoundaryEvent(el)) {

          // work with elements are in the grid
          const position = grid.find(el);
          if (position) {

            // get outgoing
            // if at least one element is not in visited, then return the element
            const elOutgoing = getOutgoingElements(el).filter(elOut => {

              // should not be in grid
              const elOutPosition = grid.find(elOut);
              return (!elOutPosition);

            });
            return elOutgoing > 0;
          }
        }
      });

      // get elements in the grid that have incoming that are not in visited
      const flippedOutgoingStart = grid.grid.reduce((acc, curRow) => {
        curRow.forEach(el => {

          // maybe need add get output from boundary
          const incoming = getIncomingElements(el);
          incoming.forEach(item => {
            if (!visited.has(item)) {
              acc.add(el);
              return acc;
            }
          });
        });
        return acc;
      }, new Set());

      // untraversed elements exiting the grid
      const outgoingFromGrid = elementsWithoutBoundary.filter(el => {

        if (!grid.find(el)) {
          const incoming = !grid.isFlipped ? new Set (getIncomingElements(el)) : new Set (getOutgoingElements(el).concat(getAttachedOutgoingElements(el)));
          for (const incomingElement of incoming) {
            if (grid.find(incomingElement)) {
              return true;
            }
          }
        }

      });

      // All elements without incoming from other elements
      // this case as the very last one
      const otherStartingElements = elementsWithoutBoundary.filter(el => {
        const incoming = !grid.isFlipped ? new Set (getIncomingElements(el)) : new Set (getOutgoingElements(el).concat(getAttachedOutgoingElements(el)));

        const withOutLoops = [ ...incoming ].filter(resEl => resEl !== el);

        return (!grid.find(el) && withOutLoops.length === 0);

      });

      let stack = [];
      let startingElements = [];

      if (startingElementsOnly.length > 0) {
        stack = [ ...startingElementsOnly ];
        startingElements = [ ...startingElementsOnly ];

        startingElements.forEach(el => {
          grid.add(el);
          visited.add(el);
        });

      } else if (outgoingElementsInGrid.length > 0) {
        stack = [ ...outgoingElementsInGrid ];
        startingElements = [ ...outgoingElementsInGrid ];
      } else if (flippedOutgoingStart.size > 0) {

        stack = [ ...flippedOutgoingStart ];
        startingElements = [ ...flippedOutgoingStart ];
        grid.flipHorizontally();
      } else if (outgoingFromGrid.length > 0) {
        stack = [ ...outgoingFromGrid ];
        startingElements = [ ...outgoingFromGrid ];
      } else if (otherStartingElements.length > 0) {
        stack = [ ...otherStartingElements ];
        startingElements = [ ...otherStartingElements ];
      }

      else {

        // just push the rest into the stack
        const allInGrid = grid.getAllElements();
        const result = elements.filter(el => {
          return (!allInGrid.some(item => item === el) && !isBoundaryEvent(el));
        });

        const withGridIncoming = result.filter(el => {
          const gridIncoming = getIncomingElements(el).filter(el => grid.find(el));
          if (gridIncoming.length > 0) {
            return true;
          }
        });

        if (withGridIncoming.length > 0) {
          stack = [ ...withGridIncoming ];
          startingElements = [ ...withGridIncoming ];
        } else {
          stack.push(result[0]);
          startingElements.push(result[0]);
        }
      }

      this.handleGrid(grid,visited,stack, grid.isFlipped);

      // square after each pass
      grid.toRectangle();

    }

    // flip grid for reverse
    if (grid.isFlipped) {
      grid.flipHorizontally();
    }
    return grid;
  }

  generateDi(root, layoutGrid) {
    const diFactory = this.diFactory;

    // Step 0: Create Root element
    const diagram = this.diagram;

    var planeDi = diFactory.createDiPlane({
      id: 'BPMNPlane_' + root.id,
      bpmnElement: root
    });
    var diagramDi = diFactory.createDiDiagram({
      id: 'BPMNDiagram_' + root.id,
      plane: planeDi
    });

    // deepest subprocess is added first - insert at the front
    diagram.diagrams.unshift(diagramDi);

    const planeElement = planeDi.get('planeElement');

    // Step 1: Create DI for all elements
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this
        .handle('createElementDi', { element, row, col, layoutGrid, diFactory })
        .flat();

      planeElement.push(...dis);
    });

    // Step 2: Create DI for all connections
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this
        .handle('createConnectionDi', { element, row, col, layoutGrid, diFactory })
        .flat();

      planeElement.push(...dis);
    });
  }

  handleGrid(grid, visited, stack, reverse) {
    while (stack.length > 0) {
      const currentElement = stack.pop();

      if (is(currentElement, 'bpmn:SubProcess')) {
        this.handlePlane(currentElement);
      }

      const nextElements = this.handle('addToGrid', { element: currentElement, grid, visited, stack, reverse });

      nextElements.flat().forEach(el => {
        stack.push(el);
        visited.add(el);
      });
      grid.shrinkCols();
    }
  }

  getProcess() {
    return this.diagram.get('rootElements').find(el => el.$type === 'bpmn:Process');
  }
}
