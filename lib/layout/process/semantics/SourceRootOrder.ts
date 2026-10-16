import { is } from '../../../di/DiUtil.js';

import type { LayoutRecord } from '../../Types.js';
import type { BpmnElement } from '../../bpmn/Types.js';
import type { ModdleElement } from 'moddle';
import type {
  BpmnBoundaryEvent,
  BpmnFlowNode,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';

type FlowNode = ModdleElement<BpmnFlowNode> & {
  eventDefinitions?: BpmnElement[];
};
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};
type BoundaryEdge = FlowEdge & {
  sourceRef: ModdleElement<BpmnBoundaryEvent> & {
    attachedToRef: FlowNode;
  };
};
type FlowRecord = LayoutRecord & {
  element: FlowNode;
};

type SourceRootOrdering = {
  constraints: Map<FlowNode, Set<FlowNode>>;
  roots: FlowNode[];
};

export function orderSourceRoots(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[]
): FlowNode[] {
  const ordering = collectSourceRootOrdering(records, graphEdges, boundaryEdges);
  const pending = new Map<FlowNode, number>(
    ordering.roots.map(root => [ root, 0 ])
  );

  for (const targets of ordering.constraints.values()) {
    for (const target of targets) {
      pending.set(target, (pending.get(target) || 0) + 1);
    }
  }

  const ready = orderNodes(ordering.roots.filter(root => {
    return pending.get(root) === 0;
  }));
  const ordered: FlowNode[] = [];

  while (ready.length) {
    const root = getRequired(ready.shift());

    ordered.push(root);

    for (const target of ordering.constraints.get(root) || []) {
      const count = (pending.get(target) || 0) - 1;

      pending.set(target, count);

      if (count === 0) {
        ready.push(target);
      }
    }

    ready.sort(compareNodes);
  }

  return ordered.length === ordering.roots.length
    ? ordered
    : orderNodes(ordering.roots);
}

function collectSourceRootOrdering(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    boundaryEdges: BoundaryEdge[]
): SourceRootOrdering {
  const incoming = new Map<FlowNode, number>(
    records.map(record => [ record.element, 0 ])
  );
  const boundaryTargets = new Set(boundaryEdges.map(edge => edge.targetRef));
  const adjacent = new Map<FlowNode, FlowNode[]>(
    records.map(record => [ record.element, [] ])
  );

  for (const edge of graphEdges) {
    incoming.set(edge.targetRef, (incoming.get(edge.targetRef) || 0) + 1);
    getRequired(adjacent.get(edge.sourceRef)).push(edge.targetRef);
    getRequired(adjacent.get(edge.targetRef)).push(edge.sourceRef);
  }

  for (const edge of boundaryEdges) {
    const host = edge.sourceRef.attachedToRef;

    getRequired(adjacent.get(host)).push(edge.targetRef);
    getRequired(adjacent.get(edge.targetRef)).push(host);
  }

  const roots = records
    .filter(record => {
      return incoming.get(record.element) === 0 &&
        !boundaryTargets.has(record.element);
    })
    .map(record => record.element);

  addCyclicComponentRoots(records, adjacent, roots);

  return {
    roots: orderNodes(roots),
    constraints: linkRootConstraints(records, graphEdges, roots)
  };
}

function addCyclicComponentRoots(
    records: FlowRecord[],
    adjacent: Map<FlowNode, FlowNode[]>,
    roots: FlowNode[]
): void {
  const rootsByComponent = new Set<FlowNode>(roots);
  const claimed = new Set<FlowNode>();

  for (const seed of orderNodes(records.map(record => record.element))) {
    if (claimed.has(seed)) {
      continue;
    }

    const component = [ seed ];
    const queue = [ seed ];

    claimed.add(seed);

    while (queue.length) {
      const node = getRequired(queue.shift());

      for (const neighbor of adjacent.get(node) || []) {
        if (!claimed.has(neighbor)) {
          claimed.add(neighbor);
          component.push(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (!component.some(node => rootsByComponent.has(node))) {
      const root = getRequired(orderNodes(component)[0]);

      roots.push(root);
      rootsByComponent.add(root);
    }
  }
}

function linkRootConstraints(
    records: FlowRecord[],
    graphEdges: FlowEdge[],
    roots: FlowNode[]
): Map<FlowNode, Set<FlowNode>> {
  const outgoing = new Map<FlowNode, FlowEdge[]>(
    records.map(record => [ record.element, [] ])
  );
  const constraints = new Map<FlowNode, Set<FlowNode>>();
  const links = new Map<string, {
    catchEvent?: FlowNode;
    throwEvent?: FlowNode;
  }>();

  for (const edge of graphEdges) {
    getRequired(outgoing.get(edge.sourceRef)).push(edge);
  }

  for (const { element } of records) {
    const definition = (element.eventDefinitions || []).find(candidate => {
      return is(candidate, 'bpmn:LinkEventDefinition');
    });

    if (!definition) {
      continue;
    }

    const name = definition.name || '';
    const link = links.get(name) || {};

    if (is(element, 'bpmn:IntermediateThrowEvent')) {
      link.throwEvent = element;
    } else if (is(element, 'bpmn:IntermediateCatchEvent')) {
      link.catchEvent = element;
    }

    links.set(name, link);
  }

  for (const { catchEvent, throwEvent } of links.values()) {
    if (!throwEvent || !catchEvent) {
      continue;
    }

    const sourceRoots = roots.filter(root => {
      return canReach(root, throwEvent, outgoing);
    });
    const targetRoots = roots.filter(root => {
      return canReach(root, catchEvent, outgoing);
    });

    for (const source of sourceRoots) {
      for (const target of targetRoots) {
        if (source === target) {
          continue;
        }

        if (!constraints.has(source)) {
          constraints.set(source, new Set());
        }

        getRequired(constraints.get(source)).add(target);
      }
    }
  }

  return constraints;
}

function canReach(
    start: FlowNode,
    target: FlowNode,
    outgoing: Map<FlowNode, FlowEdge[]>
): boolean {
  const pending = [ start ];
  const visited = new Set<FlowNode>();

  while (pending.length) {
    const node = getRequired(pending.shift());

    if (node === target) {
      return true;
    }

    if (visited.has(node)) {
      continue;
    }

    visited.add(node);
    pending.push(...(outgoing.get(node) || []).map(edge => edge.targetRef));
  }

  return false;
}

function orderNodes(nodes: readonly FlowNode[]): FlowNode[] {
  return [ ...nodes ].sort(compareNodes);
}

function compareNodes(a: FlowNode, b: FlowNode): number {
  return elementId(a).localeCompare(elementId(b));
}

function elementId(element: BpmnElement): string {
  return element.id || '';
}

function getRequired<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Expected source-root ordering value.');
  }

  return value;
}
