import assert from 'node:assert';
import { describe, it } from 'mocha';

import { BpmnModdle } from 'bpmn-moddle';

import {
  generateDiagrams
} from '../lib/layout/DiagramGeneration.js';
import type { ModdleElement } from 'moddle';
import type { BpmndiBPMNDiagram, BpmndiBPMNEdge, BpmndiBPMNShape } from '../lib/moddle-types/bpmndi.js';
import type { DcBounds, DcPoint } from '../lib/moddle-types/dc.js';
import type { DiDiagramElement } from '../lib/moddle-types/di.js';
import type { Bounds, LayoutState } from '../lib/layout/Types.js';

type BpmnDiagram = ModdleElement<BpmndiBPMNDiagram>;
type BpmnEdge = ModdleElement<BpmndiBPMNEdge>;
type BpmnShape = ModdleElement<BpmndiBPMNShape>;
type BoundsElement = ModdleElement<DcBounds>;
type PointElement = ModdleElement<DcPoint>;


describe('DiagramGeneration', function() {

  it('should generate finalized root geometry', function() {
    const moddle = new BpmnModdle();
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const source = moddle.create('bpmn:Task', { id: 'Source' });
    const target = moddle.create('bpmn:Task', { id: 'Target' });
    const flow = moddle.create('bpmn:SequenceFlow', {
      id: 'Flow',
      sourceRef: source,
      targetRef: target
    });
    const layout: LayoutState = {
      scope: process,
      shapes: new Map([
        [ source, { x: 0, y: 0, width: 100, height: 80 } ],
        [ target, { x: 200, y: 160, width: 100, height: 80 } ]
      ]),
      edges: new Map([
        [ flow, [
          { x: 100, y: 40 },
          { x: 100, y: 200 },
          { x: 200, y: 200 }
        ] ]
      ]),
      children: [],
      emitInParent: false
    };

    const diagrams = generateDiagrams(moddle, layout);
    const edge = findEdge(getRequired(diagrams[0]));

    assert.strictEqual(diagrams.length, 1);
    assert.strictEqual(getRequired(getRequired(diagrams[0]).plane).bpmnElement, process);
    assert.deepStrictEqual(getRequired(edge.waypoint).map(toPoint), [
      { x: 130, y: 160 },
      { x: 130, y: 280 },
      { x: 280, y: 280 }
    ]);
  });

  it('should generate external labels from final geometry', function() {
    const moddle = new BpmnModdle();
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const event = moddle.create('bpmn:IntermediateCatchEvent', {
      id: 'Event',
      name: 'Below'
    });
    const layout: LayoutState = {
      scope: process,
      shapes: new Map([
        [ event, { x: 100, y: 100, width: 36, height: 36 } ]
      ]),
      edges: new Map(),
      children: [],
      emitInParent: false
    };

    const diagrams = generateDiagrams(moddle, layout);
    const shape = findShape(getRequired(diagrams[0]), event);

    assert.deepStrictEqual(toBounds(getRequired(getRequired(shape.label).bounds)), {
      x: 76,
      y: 121,
      width: 44,
      height: 14
    });
  });

  it('should place labels against emitted integer geometry', function() {
    const moddle = new BpmnModdle();
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const event = moddle.create('bpmn:IntermediateCatchEvent', {
      id: 'Event',
      name: 'Below'
    });
    const layout: LayoutState = {
      scope: process,
      shapes: new Map([
        [ event, { x: 100, y: 100, width: 36.8, height: 36.8 } ]
      ]),
      edges: new Map(),
      children: [],
      emitInParent: false
    };

    const diagrams = generateDiagrams(moddle, layout);
    const shape = findShape(getRequired(diagrams[0]), event);

    assert.deepStrictEqual(toBounds(getRequired(shape.bounds)), {
      x: 80,
      y: 80,
      width: 37,
      height: 37
    });
    assert.deepStrictEqual(toBounds(getRequired(getRequired(shape.label).bounds)), {
      x: 77,
      y: 122,
      width: 44,
      height: 14
    });
  });

  it('should generate separate diagrams for collapsed subprocess layouts', function() {
    const moddle = new BpmnModdle();
    const process = moddle.create('bpmn:Process', { id: 'Process' });
    const subprocess = moddle.create('bpmn:SubProcess', { id: 'SubProcess' });
    const event = moddle.create('bpmn:IntermediateCatchEvent', {
      id: 'Event',
      name: 'Below'
    });
    const child: LayoutState = {
      scope: subprocess,
      shapes: new Map([
        [ event, { x: 300, y: 300, width: 36, height: 36 } ]
      ]),
      edges: new Map(),
      children: [],
      emitInParent: false
    };
    const layout: LayoutState = {
      scope: process,
      shapes: new Map([
        [ subprocess, { x: 0, y: 0, width: 100, height: 80 } ]
      ]),
      edges: new Map(),
      children: [ child ],
      emitInParent: false
    };

    const diagrams = generateDiagrams(moddle, layout);
    const childShape = findShape(getRequired(diagrams[1]), event);

    assert.deepStrictEqual(
      diagrams.map(diagram => getRequired(diagram.plane).bpmnElement),
      [ process, subprocess ]
    );
    assert.deepStrictEqual(toBounds(getRequired(childShape.bounds)), {
      x: 80,
      y: 80,
      width: 36,
      height: 36
    });
    assert.deepStrictEqual(toBounds(getRequired(getRequired(childShape.label).bounds)), {
      x: 76,
      y: 121,
      width: 44,
      height: 14
    });
  });
});

function findEdge(diagram: BpmnDiagram): BpmnEdge {
  return getRequired(getRequired(diagram.plane).planeElement?.find(isBpmnEdge));
}

function findShape(diagram: BpmnDiagram, element: LayoutState['scope']): BpmnShape {
  return getRequired(getRequired(diagram.plane).planeElement?.find(candidate => {
    return isBpmnShape(candidate) && candidate.bpmnElement === element;
  }));
}

function isBpmnEdge(element: ModdleElement<DiDiagramElement>): element is BpmnEdge {
  return element.$instanceOf('bpmndi:BPMNEdge');
}

function isBpmnShape(element: ModdleElement<DiDiagramElement>): element is BpmnShape {
  return element.$instanceOf('bpmndi:BPMNShape');
}

function toPoint(point: PointElement): { x: number; y: number } {
  return { x: getRequired(point.x), y: getRequired(point.y) };
}

function toBounds(bounds: BoundsElement): Bounds {
  return {
    x: getRequired(bounds.x), y: getRequired(bounds.y),
    width: getRequired(bounds.width), height: getRequired(bounds.height)
  };
}

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected generated diagram element');
  }

  return value;
}
