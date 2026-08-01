import { is } from '../../../di/DiUtil.js';
import { translateLayout } from '../../geometry/index.js';

import type {
  BpmnElement,
  Bounds,
  FeedbackRegion,
  LayoutState,
  ProcessLayoutContext
} from '../../Types.js';
import {
  clonePlacementCandidate
} from './PlacementCandidate.js';
import type { PlacementCandidate } from './PlacementCandidate.js';

export function createFeedbackMirrorCandidate(
    context: ProcessLayoutContext,
    candidate: PlacementCandidate,
    region: FeedbackRegion,
    moveKey: string
): PlacementCandidate | null {
  const split = candidate.layout.shapes.get(region.split);

  if (!split) {
    return null;
  }

  const next = clonePlacementCandidate(candidate, moveKey);
  const splitCenter = split.y + split.height / 2;
  const movements = new Map<BpmnElement, number>();

  for (const branch of region.branches) {
    const branchBounds = [ ...branch.nodes ]
      .map(element => candidate.layout.shapes.get(element))
      .filter((rect): rect is Bounds => !!rect);

    if (!branchBounds.length) {
      continue;
    }

    const branchCenter = branchBounds.reduce((total, rect) => {
      return total + rect.y + rect.height / 2;
    }, 0) / branchBounds.length;
    const dy = Math.round(2 * (splitCenter - branchCenter));

    if (!dy) {
      continue;
    }

    for (const element of branch.nodes) {
      const existing = movements.get(element);

      if (existing !== undefined && existing !== dy) {
        return null;
      }

      movements.set(element, dy);
    }
  }

  if (!movements.size) {
    return null;
  }

  includeAttachedBoundaryEvents(candidate.layout, movements);

  if (!fitsOriginalContainers(candidate.layout, movements)) {
    return null;
  }

  for (const [ element, dy ] of movements) {
    const rect = next.layout.shapes.get(element);

    if (!rect) {
      continue;
    }

    rect.y += dy;
    next.displacement += Math.abs(dy);
    translateExpandedChild(context, next.layout, element, dy);
  }

  return next;
}

export function flattenFeedbackRegions(
    regions: FeedbackRegion[]
): FeedbackRegion[] {
  return regions.flatMap(region => [
    region,
    ...flattenFeedbackRegions(region.children)
  ]);
}

function includeAttachedBoundaryEvents(
    layout: LayoutState,
    movements: Map<BpmnElement, number>
): void {
  for (const element of layout.shapes.keys()) {
    if (!is(element, 'bpmn:BoundaryEvent')) {
      continue;
    }

    const host = element.attachedToRef;

    if (!host) {
      continue;
    }

    const dy = movements.get(host);

    if (dy !== undefined) {
      movements.set(element, dy);
    }
  }
}

function fitsOriginalContainers(
    layout: LayoutState,
    movements: Map<BpmnElement, number>
): boolean {
  const containers = [ ...layout.shapes ]
    .filter(([ element ]) => {
      return is(element, 'bpmn:Lane') || is(element, 'bpmn:Participant');
    })
    .map(([ , rect ]) => rect);

  for (const [ element, dy ] of movements) {
    const rect = layout.shapes.get(element);

    if (!rect) {
      continue;
    }

    const memberships = containers.filter(container => {
      return containsCenter(container, rect);
    });
    const moved = {
      ...rect,
      y: rect.y + dy
    };

    if (memberships.some(container => !containsRect(container, moved))) {
      return false;
    }
  }

  return true;
}

function translateExpandedChild(
    context: ProcessLayoutContext,
    layout: LayoutState,
    element: BpmnElement,
    dy: number
): void {
  const childScope = context.placement.recordsByElement.get(element)?.child?.scope;

  if (!childScope) {
    return;
  }

  const child = findChildLayout(layout, childScope);

  if (child) {
    translateLayout(child, 0, dy);
  }
}

function findChildLayout(
    layout: LayoutState,
    scope: BpmnElement
): LayoutState | null {
  for (const child of layout.children) {
    if (child.scope === scope) {
      return child;
    }

    const nested = findChildLayout(child, scope);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function containsCenter(container: Bounds, rect: Bounds): boolean {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;

  return x >= container.x && x <= container.x + container.width &&
    y >= container.y && y <= container.y + container.height;
}

function containsRect(container: Bounds, rect: Bounds): boolean {
  return rect.x >= container.x &&
    rect.y >= container.y &&
    rect.x + rect.width <= container.x + container.width &&
    rect.y + rect.height <= container.y + container.height;
}
