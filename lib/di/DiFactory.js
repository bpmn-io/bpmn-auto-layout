import { assign, map, pick } from 'min-dash';


export class DiFactory {
  constructor(moddle) {
    this.moddle = moddle;
  }

  create(type, attrs) {
    return this.moddle.create(type, attrs || {});
  }

  createDiBounds(bounds) {
    return this.create('dc:Bounds', bounds);
  }

  createDiLabel() {
    return this.create('bpmndi:BPMNLabel', {
      bounds: this.createDiBounds()
    });
  }

  createDiShape(semantic, bounds, attrs) {
    return this.create('bpmndi:BPMNShape', assign({
      bpmnElement: semantic,
      bounds: this.createDiBounds(bounds)
    }, attrs));
  }

  createDiWaypoints(waypoints) {
    var self = this;

    return map(waypoints, function(pos) {
      return self.createDiWaypoint(pos);
    });
  }

  createDiWaypoint(point) {
    return this.create('dc:Point', pick(point, [ 'x', 'y' ]));
  }

  createDiEdge(semantic, waypoints, attrs) {
    return this.create('bpmndi:BPMNEdge', assign({
      bpmnElement: semantic,
      waypoint: this.createDiWaypoints(waypoints)
    }, attrs));
  }

  createDiPlane(attrs) {
    return this.create('bpmndi:BPMNPlane', attrs);
  }

  createDiDiagram(attrs) {
    return this.create('bpmndi:BPMNDiagram', attrs);
  }
}