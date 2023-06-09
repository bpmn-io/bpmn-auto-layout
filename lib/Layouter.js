import BPMNModdle from 'bpmn-moddle';
import { isBoundaryEvent, isConnection } from './utils/elementUtils';
import { Grid } from './Grid';
import { DiFactory } from './di/DiFactory';
import { connectElements, getBounds } from './utils/layoutUtil';
import { is } from './di/DiUtil';

export class Layouter {
  constructor() {
    this.moddle = new BPMNModdle();
    this.diFactory = new DiFactory(this.moddle);
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

    // const process = this.getProcess();
    const flowElements = root.flowElements;

    const startingElements = flowElements.filter(el => {
      return !isConnection(el) && !isBoundaryEvent(el) && (!el.incoming || el.length === 0);
    });

    const boundaryEvents = flowElements.filter(el => isBoundaryEvent(el));
    boundaryEvents.forEach(boundaryEvent => {
      const attachedTask = boundaryEvent.attachedToRef;
      const attachers = attachedTask.attachers || [];
      attachers.push(boundaryEvent);
      attachedTask.attachers = attachers;
    });

    // Depth-first-search
    const stack = [ ...startingElements ];
    const visited = new Set();

    startingElements.forEach(el => {
      grid.add(el);
      visited.add(el);
    });

    while (stack.length > 0) {
      const currentElement = stack.pop();

      if (is(currentElement, 'bpmn:SubProcess')) {
        this.handlePlane(currentElement);
      }

      // Handle outgoing paths
      const outgoing = (currentElement.outgoing || [])
        .map(out => out.targetRef)
        .filter(el => el);

      let previousElement = null;
      outgoing.forEach((nextElement, index, arr) => {
        if (visited.has(nextElement)) {
          return;
        }

        if (!previousElement) {
          grid.addAfter(currentElement, nextElement);
        }
        else {
          grid.addBelow(arr[index - 1], nextElement);
        }

        // Is self-looping
        if (nextElement !== currentElement) {
          previousElement = nextElement;
        }
      });

      const attachedOutgoing = (currentElement.attachers || [])
        .map(att => att.outgoing)
        .flat()
        .map(out => out.targetRef);

      // handle boundary events
      attachedOutgoing.forEach((nextElement, index, arr) => {
        if (visited.has(nextElement)) {
          return;
        }

        const below = arr[index - 1] || currentElement;
        grid.addBelow(below, nextElement);
        stack.push(nextElement);
        visited.add(nextElement);
      });

      // add to stack in reverse order: first element should be first of the stack
      outgoing.reverse().forEach(el => {
        if (visited.has(el)) {
          return;
        }
        visited.add(el);
        stack.push(el);
      });
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
      const bounds = getBounds(element, row, col);

      const shapeDi = diFactory.createDiShape(element, bounds, {
        id: element.id + '_di'
      });
      element.di = shapeDi;
      element.gridPosition = { row, col };

      planeElement.push(shapeDi);

      // handle attachers
      (element.attachers || []).forEach(att => {
        att.gridPosition = { row, col };
        const attacherBounds = getBounds(att, row, col, element);

        const attacherDi = diFactory.createDiShape(att, attacherBounds, {
          id: att.id + '_di'
        });
        att.di = attacherDi;
        att.gridPosition = { row, col };

        planeElement.push(attacherDi);
      });
    });

    // Step 2: Create DI for all connections
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const outgoing = element.outgoing || [];

      outgoing.forEach(out => {
        const target = out.targetRef;
        const waypoints = connectElements(element, target, layoutGrid);

        const connectionDi = diFactory.createDiEdge(out, waypoints, {
          id: out.id + '_di'
        });

        planeElement.push(connectionDi);
      });

      // handle attachers
      (element.attachers || []).forEach(att => {
        const outgoing = att.outgoing || [];

        outgoing.forEach(out => {
          const target = out.targetRef;
          const waypoints = connectElements(att, target, layoutGrid);

          const connectionDi = diFactory.createDiEdge(out, waypoints, {
            id: out.id + '_di'
          });

          planeElement.push(connectionDi);
        });
      });

    });
  }


  getProcess() {
    return this.diagram.get('rootElements').find(el => el.$type === 'bpmn:Process');
  }
}
