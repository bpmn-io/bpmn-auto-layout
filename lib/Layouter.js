import BPMNModdle from 'bpmn-moddle';
import { isBoundaryEvent, isConnection } from './utils/elementUtils.js';
import { DEFAULT_CELL_HEIGHT, DEFAULT_CELL_WIDTH } from './utils/layoutUtil.js';
import { Grid } from './Grid.js';
import { DiFactory } from './di/DiFactory.js';
import { is, getDefaultSize } from './di/DiUtil.js';
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
    const moddleObj = await this.moddle.fromXML(xml);
    const { rootElement } = moddleObj;

    this.diagram = rootElement;

    const firstRootProcess = this.getProcess();

    if (firstRootProcess) {

      this.setExpandedPropertyToModdleElements(moddleObj);

      this.setExecutedProcesses(firstRootProcess);

      this.createGridsForProcesses();

      this.cleanDi();

      this.createRootDi(firstRootProcess);

      this.drawProcesses();
    }

    return (await this.moddle.toXML(this.diagram, { format: true })).xml;
  }

  createGridsForProcesses() {
    const processes = this.layoutedProcesses.sort((a, b) => b.level - a.level);

    // create and add grids for each process
    // root processes should be processed last for element expanding
    for (const process of processes) {

      // add base grid with collapsed elements
      process.grid = this.createGridLayout(process);

      expandGridHorizontally(process.grid);
      expandGridVertically(process.grid);

      if (process.isExpanded) {
        const [ rowCount, colCount ] = process.grid.getGridDimensions();
        if (rowCount === 0) process.grid.createRow();
        if (colCount === 0) process.grid.createCol();
      }

    }
  }

  setExpandedPropertyToModdleElements(bpmnModel) {
    const allElements = bpmnModel.elementsById;
    if (allElements) {
      for (const element of Object.values(allElements)) {
        if (element.$type === 'bpmndi:BPMNShape' && element.isExpanded === true) element.bpmnElement.isExpanded = true;
      }
    }
  }

  setExecutedProcesses(firstRootProcess) {
    this.layoutedProcesses = [];

    const executionStack = [ firstRootProcess ];

    while (executionStack.length > 0) {
      const executedProcess = executionStack.pop();
      this.layoutedProcesses.push(executedProcess);
      executedProcess.level = executedProcess.$parent === this.diagram ? 0 : executedProcess.$parent.level + 1;

      const nextProcesses = executedProcess.flowElements?.filter(flowElement => flowElement.$type === 'bpmn:SubProcess') || [];

      executionStack.splice(executionStack.length, 0, ...nextProcesses);
    }
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

    bindBoundaryEventsWithHosts (flowElements);

    // Depth-first-search
    const visited = new Set();
    while (visited.size < elements.filter(element => !element.attachedToRef).length) {
      const startingElements = flowElements.filter(el => {
        return !isConnection(el) &&
            !isBoundaryEvent(el) &&
            (!el.incoming || !hasOtherIncoming(el)) &&
            !visited.has(el);
      });

      const stack = [ ...startingElements ];

      startingElements.forEach(el => {
        grid.add(el);
        visited.add(el);
      });

      this.handleGrid(grid,visited,stack);

      if (grid.getElementsTotal() !== elements.length) {
        const gridElements = grid.getAllElements();
        const missingElements = elements.filter(el => !gridElements.includes(el) && !isBoundaryEvent(el));
        if (missingElements.length > 0) {
          stack.push(missingElements[0]);
          grid.add(missingElements[0]);
          visited.add(missingElements[0]);
          this.handleGrid(grid,visited,stack);
        }
      }
    }
    return grid;
  }

  generateDi(layoutGrid , shift, procDi) {
    const diFactory = this.diFactory;

    const prePlaneElement = procDi ? procDi : this.diagram.diagrams[0];

    const planeElement = prePlaneElement.plane.get('planeElement');

    // Step 1: Create DI for all elements
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this
        .handle('createElementDi', { element, row, col, layoutGrid, diFactory, shift })
        .flat();

      planeElement.push(...dis);
    });

    // Step 2: Create DI for all connections
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this
        .handle('createConnectionDi', { element, row, col, layoutGrid, diFactory, shift })
        .flat();

      planeElement.push(...dis);
    });
  }

  handleGrid(grid, visited, stack) {
    while (stack.length > 0) {
      const currentElement = stack.pop();

      const nextElements = this.handle('addToGrid', { element: currentElement, grid, visited, stack });

      nextElements.flat().forEach(el => {
        stack.push(el);
        visited.add(el);
      });
    }
  }

  getProcess() {
    return this.diagram.get('rootElements').find(el => el.$type === 'bpmn:Process');
  }

  createRootDi(processes) {
    this.createProcessDi(processes);
  }

  createProcessDi(element) {
    const diFactory = this.diFactory;

    const planeDi = diFactory.createDiPlane({
      id: 'BPMNPlane_' + element.id,
      bpmnElement: element
    });
    const diagramDi = diFactory.createDiDiagram({
      id: 'BPMNDiagram_' + element.id,
      plane: planeDi
    });

    const diagram = this.diagram;

    diagram.diagrams.push(diagramDi);

    return diagramDi;
  }

  /**
   * Draw processes.
   * Root processes should be processed first for element expanding
   */
  drawProcesses() {
    const sortedProcesses = this.layoutedProcesses.sort((a, b) => a.level - b.level);

    for (const process of sortedProcesses) {

      // draw processes in expanded elements
      if (process.isExpanded) {
        const baseProcDi = this.getElementDi(process);
        const diagram = this.getProcDi(baseProcDi);
        let { x, y } = baseProcDi.bounds;
        const { width, height } = getDefaultSize(process);
        x += DEFAULT_CELL_WIDTH / 2 - width / 4;
        y += DEFAULT_CELL_HEIGHT - height - height / 4;
        this.generateDi(process.grid, { x, y }, diagram);
        continue;
      }

      // draw other processes
      const diagram = this.diagram.diagrams.find(diagram => diagram.plane.bpmnElement === process);
      this.generateDi(process.grid, { x: 0, y: 0 }, diagram);
    }
  }

  getElementDi(element) {
    return this.diagram.diagrams
      .map(diagram => diagram.plane.planeElement).flat()
      .find(item => item.bpmnElement === element);
  }

  getProcDi(element) {
    return this.diagram.diagrams.find(diagram => diagram.plane.planeElement.includes(element));
  }
}

export function bindBoundaryEventsWithHosts(elements) {
  const boundaryEvents = elements.filter(element => isBoundaryEvent(element));
  boundaryEvents.forEach(boundaryEvent => {
    const attachedTask = boundaryEvent.attachedToRef;
    const attachers = attachedTask.attachers || [];
    attachers.push(boundaryEvent);
    attachedTask.attachers = attachers;
  });
}

/**
 * Check grid by columns.
 * If column has elements with isExpanded === true,
 * find the maximum size of elements grids and expand the parent grid horizontally.
 * @param grid
 */
function expandGridHorizontally(grid) {
  const [ numRows , maxCols ] = grid.getGridDimensions();
  for (let i = maxCols - 1 ; i >= 0; i--) {
    const elementsInCol = [];
    for (let j = 0; j < numRows; j++) {
      const candidate = grid.get(j, i);
      if (candidate && candidate.isExpanded) elementsInCol.push(candidate);
    }

    if (elementsInCol.length === 0) continue;

    const maxColCount = elementsInCol.reduce((acc,cur) => {
      const [ ,curCols ] = cur.grid.getGridDimensions();
      if (acc === undefined || curCols > acc) return curCols;
      return acc;
    }, undefined);

    const shift = !maxColCount ? 2 : maxColCount;
    grid.createCol(i, shift);
  }
}

/**
 * Check grid by rows.
 * If row has elements with isExpanded === true,
 * find the maximum size of elements grids and expand the parent grid vertically.
 * @param grid
 */
function expandGridVertically(grid) {
  const [ numRows , maxCols ] = grid.getGridDimensions();

  for (let i = numRows - 1 ; i >= 0; i--) {
    const elementsInRow = [];
    for (let j = 0; j < maxCols; j++) {
      const candidate = grid.get(i, j);
      if (candidate && candidate.isExpanded) elementsInRow.push(candidate);
    }

    if (elementsInRow.length === 0) continue;

    const maxRowCount = elementsInRow.reduce((acc,cur) => {
      const [ curRows ] = cur.grid.getGridDimensions();
      if (acc === undefined || curRows > acc) return curRows;
      return acc;
    }, undefined);

    const shift = !maxRowCount ? 1 : maxRowCount;

    // expand the parent grid vertically
    for (let index = 0; index < shift; index++) {
      grid.createRow(i);
    }
  }
}

function hasOtherIncoming(element) {
  const fromHost = element.incoming?.filter(edge => edge.sourceRef !== element && edge.sourceRef.attachedToRef === undefined) || [];

  const fromAttached = element.incoming?.filter(edge => edge.sourceRef !== element
      && edge.sourceRef.attachedToRef !== element);

  return fromHost?.length > 0 || fromAttached?.length > 0;
}
