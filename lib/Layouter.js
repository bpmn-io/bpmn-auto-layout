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
    // layout.toRectangle()
    // layout.flipHorizontally()
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



    // Depth-first-search

    //

    // const stack = [ ...nextStartingElements, ...startingElements];
    // const stack = [ ...startingElements, ...nextStartingElements ];


    const elementsWithoutBoundary = elements.filter(el => !isBoundaryEvent(el));

    const visited = new Set();

    while (grid.getAllElements().length < elementsWithoutBoundary.length ) {


      // Здесь добавить обработку boundary
      const startingElementsOnly  = flowElements.filter(el => {
        // работаем только с теми, которых нет в гриде
        const position = grid.find(el)
        if (!position) {
          return !isConnection(el) && !isBoundaryEvent(el) && (!el.incoming || el.length === 0) && !isStartIntermediate(el);
        }
      });

      // здесь добавить еще
      const outgoingElementsInGrid = elementsWithoutBoundary.filter(el => {
        if (!isBoundaryEvent(el)) {

          // работаем только с теми, которые есть в гриде
          const position = grid.find(el)
          if (position) {
            // получаем исходящие
            // если хотя бы одного элемента нет в visited, то возвращаем элемент
            const elOutgoing = getOutgoingElements(el).filter(elOut => {
              // не должен быть в гриде
              const elOutPosition = grid.find(elOut)
              return (!elOutPosition)

            });
            return elOutgoing > 0
          }
        }
      })

      // находим те, которые заходят в грид
      // const ingoingElementsToGrid = []
      // elementsWithoutBoundary.forEach(el => {
      //   if (!isBoundaryEvent(el)) {
      //
      //     // работаем только с теми, которые есть в гриде
      //     const [elRow, elCol] = grid.find(el)
      //     if ((Number.isInteger(elRow) && elRow >= 0) && (Number.isInteger(elCol) || elCol >= 0)) {
      //       // получаем входящие
      //       const incoming = (el.incoming || [])
      //           .map(out => out.sourceRef)
      //           .filter(el => el);
      //
      //       incoming.forEach(incomingElement => {
      //         const [incomingRow, incomingCol] = grid.find(incomingElement)
      //         if ((!Number.isInteger(incomingRow) || incomingRow < 0) || (!Number.isInteger(incomingCol) || incomingCol < 0)){
      //           ingoingElementsToGrid.push(incomingElement);
      //         }
      //       })
      //     }
      //   }
      // })

      // Находим элементы в гриде у которых есть входящие, отсутствующие в visited
      const flippedOutgoingStart = grid.grid.reduce((acc, curRow) => {
        curRow.forEach(el => {
          // возможно добавить получение исходчщих из boundary
          const incoming = getIncomingElements(el)
          incoming.forEach(item => {
            if (!visited.has(item)) {
              acc.add(el)
              return acc
            }
          })
        })
        return acc;
      }, new Set())

      const startIntermediate = elementsWithoutBoundary.filter(el => {
        // работаем только с теми, которых нет в гриде
        const elPosition = grid.find(el)
        if (!elPosition){
          return isStartIntermediate(el)
        }
      });





      // вот здесь начало первого прохода
      // забираем в отдельный массив все bpmn:IntermediateCatchEvent или bpmn:IntermediateThrowEvent без incoming
      // const nextStartingElements = startingElements.filter(element => isStartIntermediate(element));
      // startingElements = startingElements.filter(element => !isStartIntermediate(element))
      let stack = [];
      let startingElements = []

      if (startingElementsOnly.length > 0) {
        stack = [ ...startingElementsOnly ]
        startingElements = [ ...startingElementsOnly ]

        startingElements.forEach(el => {
          grid.add(el);
          visited.add(el);
        });

      } else if (outgoingElementsInGrid.length > 0) {
        stack = [ ...outgoingElementsInGrid ]
        startingElements = [ ...outgoingElementsInGrid ]
      } else if (flippedOutgoingStart.size > 0) {

        stack = [ ...flippedOutgoingStart ]
        startingElements = [ ...flippedOutgoingStart ]
        grid.flipHorizontally()
      }
      // пока берем только исходящие
      // else if (startIntermediate.length > 0) {
      //   stack = [ ...startIntermediate ]
      //   startingElements = [ ...startIntermediate ]
      // }
      else {
        // здесь впринципе уже ничего не будет просто засунем в стек остаток
        const allInGrid = grid.getAllElements()
        const result = elements.filter(el => {
          return (!allInGrid.some(item => item === el) && !isBoundaryEvent(el))
        })

        stack = [ ...result ]
        startingElements = [ ...result ]
      }

      this.handleGrid(grid,visited,stack, grid.isFlipped);

      // задача этого костыля пропихнуть дальше граф, обработка которого остановилась на isFutureIncoming
      // Переработаем его таким образом, чтобы брал в стек все элементы в которые есть входящие из элементов грида
      // const newStartElements = new Set()
      // grid.grid.forEach(row => {
      //   row.forEach(el => {
      //     if (!grid.isFlipped) {
      //       getOutgoingElements(el).forEach(out => {
      //         if (!grid.find(out)) newStartElements.add(out)
      //       })
      //       getAttachedOutgoingElements(el).forEach(out => {
      //         if (!grid.find(out)) newStartElements.add(out)
      //       })
      //     } else {
      //       getIncomingElements(el).forEach(out => {
      //         if (!grid.find(out)) newStartElements.add(out)
      //       })
      //     }
      //   })
      // })
      //
      // stack = [ ...newStartElements ]
      // this.handleGrid(grid,visited,stack, grid.isFlipped);


      // if (grid.getElementsTotal() !== elements.length) {
      //   const gridElements = grid.getAllElements();
      //   // const missingElements = elements.filter(el => !gridElements.includes(el) && !isBoundaryEvent(el) && !isStartIntermediate(el));
      //   const missingElements = elements.filter(el => !gridElements.includes(el) && !isBoundaryEvent(el));
      //   if (missingElements.length > 1) {
      //     stack.push(missingElements[0]);
      //     grid.add(missingElements[0]);
      //     visited.add(missingElements[0]);
      //     this.handleGrid(grid,visited,stack, grid.isFlipped);
      //   }
      // }



      //
      if (grid.getElementsTotal() !== elementsWithoutBoundary.length) {
        const gridElements = grid.getAllElements();
        // const missingElements = elements.filter(el => !gridElements.includes(el) && !isBoundaryEvent(el) && !isStartIntermediate(el));
        const missingElements = elements.filter(el => !gridElements.includes(el) && !isBoundaryEvent(el));
        if (missingElements.length > 1) {

          stack.push(missingElements[0]);
          grid.add(missingElements[0]);
          visited.add(missingElements[0]);
          this.handleGrid(grid,visited,stack, grid.isFlipped);
        }
      }


      // оквадрачиваем после каждого прохода
      grid.toRectangle()


    }



    // оквадрачиваем
    // флиппаем

    if (grid.isFlipped) {
      grid.flipHorizontally()
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
