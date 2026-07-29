import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';

import {
  generateDiagrams
} from '../lib/layout/DiagramGeneration.js';

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
    const layout = {
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
    const edge = diagrams[0].plane.planeElement.find(element => {
      return element.$instanceOf('bpmndi:BPMNEdge');
    });

    assert.strictEqual(diagrams.length, 1);
    assert.strictEqual(diagrams[0].plane.bpmnElement, process);
    assert.deepStrictEqual(edge.waypoint.map(toPoint), [
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
    const layout = {
      scope: process,
      shapes: new Map([
        [ event, { x: 100, y: 100, width: 36, height: 36 } ]
      ]),
      edges: new Map(),
      children: [],
      emitInParent: false
    };

    const diagrams = generateDiagrams(moddle, layout);
    const shape = diagrams[0].plane.planeElement.find(element => {
      return element.bpmnElement === event;
    });

    assert.deepStrictEqual(toBounds(shape.label.bounds), {
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
    const layout = {
      scope: process,
      shapes: new Map([
        [ event, { x: 100, y: 100, width: 36.8, height: 36.8 } ]
      ]),
      edges: new Map(),
      children: [],
      emitInParent: false
    };

    const diagrams = generateDiagrams(moddle, layout);
    const shape = diagrams[0].plane.planeElement.find(element => {
      return element.bpmnElement === event;
    });

    assert.deepStrictEqual(toBounds(shape.bounds), {
      x: 80,
      y: 80,
      width: 37,
      height: 37
    });
    assert.deepStrictEqual(toBounds(shape.label.bounds), {
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
    const child = {
      scope: subprocess,
      shapes: new Map([
        [ event, { x: 300, y: 300, width: 36, height: 36 } ]
      ]),
      edges: new Map(),
      children: [],
      emitInParent: false
    };
    const layout = {
      scope: process,
      shapes: new Map([
        [ subprocess, { x: 0, y: 0, width: 100, height: 80 } ]
      ]),
      edges: new Map(),
      children: [ child ],
      emitInParent: false
    };

    const diagrams = generateDiagrams(moddle, layout);
    const childShape = diagrams[1].plane.planeElement.find(element => {
      return element.bpmnElement === event;
    });

    assert.deepStrictEqual(
      diagrams.map(diagram => diagram.plane.bpmnElement),
      [ process, subprocess ]
    );
    assert.deepStrictEqual(toBounds(childShape.bounds), {
      x: 80,
      y: 80,
      width: 36,
      height: 36
    });
    assert.deepStrictEqual(toBounds(childShape.label.bounds), {
      x: 76,
      y: 121,
      width: 44,
      height: 14
    });
  });
});

function toPoint({ x, y }) {
  return { x, y };
}

function toBounds({ x, y, width, height }) {
  return { x, y, width, height };
}
