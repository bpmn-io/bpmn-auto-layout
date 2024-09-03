import BPMNModdle from 'bpmn-moddle';
import { isBoundaryEvent, isConnection } from './utils/elementUtils.js';
import { sortByType, sortBySplittingMergingAndNone, sortByPosition } from './utils/sortingUtils.js';
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

    this.cleanDi();
    this.handlePlane(root);

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

    const flowElements = root.flowElements;

    // Find starting elements and sort type bpmn:StartEvent to the front
    const startingElements = sortByType(flowElements.filter(el => {
      return !isConnection(el) && !isBoundaryEvent(el) && (!el.incoming || el.incoming.length === 0);
    }), 'bpmn:StartEvent');

    const boundaryEvents = flowElements.filter(el => isBoundaryEvent(el));
    boundaryEvents.forEach(boundaryEvent => {
      const attachedTask = boundaryEvent.attachedToRef;
      const attachers = attachedTask.attachers || [];
      attachers.push(boundaryEvent);
      attachedTask.attachers = attachers;
    });

    // the stack contains the already placed elements to be visited next
    const stack = [];

    // skipped and reversedSkipped are used for elements that need to be revisited when the stack is empty
    const skipped = [];
    const reversedSkipped = [];

    // visited keeps track of all already placed elements
    const visited = new Set();

    // we start with a start event and place as many elements as possible, then loop through the rest
    startingElements.forEach(el => {
      if (!visited.has(el)) {
        grid.add(el);
        visited.add(el);
        stack.push(el);
      }

      while (stack.length > 0 || skipped.length > 0 || reversedSkipped.length > 0) {
        if (stack.length > 0) {
          const currentElement = stack.pop();

          if (is(currentElement, 'bpmn:SubProcess')) {
            this.handlePlane(currentElement);
          }

          // in the default step, we do not force a layout and do not model backwards
          const nextElements = this.handle('addToGrid', { element: currentElement, grid, visited, skipped, reversedSkipped, force: false, backwards: false });
          nextElements.flat().forEach(el => {
            stack.push(el);
          });
        }

        if (stack.length === 0 && skipped.length !== 0) {

          // we sort by position to revisited the left-most elements first, then by splitting and merging behavior, to first layout simple elements
          const currentElement = sortBySplittingMergingAndNone(sortByPosition(grid, skipped)).pop();

          // in this step, we revisit skipped elements with outgoing elements and force at max one layout, and we do not model backwards
          const nextElements = this.handle('addToGrid', { element: currentElement, grid, visited, skipped, reversedSkipped, force: true, backwards: false });
          nextElements.flat().forEach(el => {
            stack.push(el);
          });
        }

        if (stack.length === 0 && skipped.length === 0 && reversedSkipped.length !== 0) {

          // we sort by position to revisited the left-most elements first, then by splitting and merging behavior, to first layout simple elements
          const currentElement = sortBySplittingMergingAndNone(sortByPosition(grid, reversedSkipped)).pop();

          // in this step, we revisit skipped elements with incoming elements and force at max one layout, and we model forwards and backwards
          const nextElements = this.handle('addToGrid', { element: currentElement, grid, visited, skipped, reversedSkipped, force: true, backwards: true });
          nextElements.flat().forEach(el => {
            stack.push(el);
          });
        }
      }
    });

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


  getProcess() {
    return this.diagram.get('rootElements').find(el => el.$type === 'bpmn:Process');
  }
}
