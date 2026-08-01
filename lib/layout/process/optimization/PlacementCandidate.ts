import type {
  BpmnElement,
  Bounds,
  LayoutState,
  Waypoint
} from '../../Types.js';

export type PlacementCandidate = {
  layout: LayoutState;
  moveKey: string;
  displacement: number;
};

export function clonePlacementCandidate(
    candidate: PlacementCandidate,
    moveKey: string
): PlacementCandidate {
  return {
    layout: cloneLayout(candidate.layout),
    moveKey,
    displacement: candidate.displacement
  };
}

export function createBaselineCandidate(layout: LayoutState): PlacementCandidate {
  return {
    layout: cloneLayout(layout),
    moveKey: 'baseline',
    displacement: 0
  };
}

export function commitPlacementCandidate(
    target: LayoutState,
    candidate: PlacementCandidate
): void {
  copyLayout(target, candidate.layout);
}

function cloneLayout(layout: LayoutState): LayoutState {
  return {
    scope: layout.scope,
    shapes: new Map(
      [ ...layout.shapes ].map(([ element, rect ]) => [
        element,
        cloneBounds(rect)
      ])
    ),
    edges: new Map(
      [ ...layout.edges ].map(([ element, points ]) => [
        element,
        cloneWaypoints(points)
      ])
    ),
    children: layout.children.map(cloneLayout),
    emitInParent: layout.emitInParent
  };
}

function copyLayout(target: LayoutState, source: LayoutState): void {
  for (const [ element, sourceBounds ] of source.shapes) {
    const targetBounds = target.shapes.get(element);

    if (targetBounds) {
      Object.assign(targetBounds, sourceBounds);
    } else {
      target.shapes.set(element, cloneBounds(sourceBounds));
    }
  }

  target.edges.clear();

  for (const [ element, points ] of source.edges) {
    target.edges.set(element, cloneWaypoints(points));
  }

  const sourceChildren = new Map<BpmnElement, LayoutState>(
    source.children.map(child => [ child.scope, child ])
  );

  for (const child of target.children) {
    const sourceChild = sourceChildren.get(child.scope);

    if (sourceChild) {
      copyLayout(child, sourceChild);
    }
  }
}

function cloneBounds(rect: Bounds): Bounds {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
}

function cloneWaypoints(points: Waypoint[]): Waypoint[] {
  return points.map(({ x, y }) => ({ x, y }));
}
