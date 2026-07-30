import { LayoutWarning } from '../../LayoutWarning.js';
import { GROUP_PADDING } from '../Constants.js';
import {
  bounds,
  getExpandedChildEdges,
  getExpandedChildShapes
} from '../geometry/index.js';
import { isBpmnElement } from '../bpmn/Types.js';

import type { ModdleElement } from 'moddle';
import type { BpmnCategoryValue, BpmnGroup } from '../../moddle-types/bpmn.js';
import type {
  BpmnElement,
  LayoutState
} from '../Types.js';

export function layoutGroups(
    groups: Array<ModdleElement<BpmnGroup>>,
    layout: LayoutState
): LayoutWarning[] {
  const warnings: LayoutWarning[] = [];
  const shapes = [
    ...layout.shapes.entries(),
    ...getExpandedChildShapes(layout)
  ];
  const edges = [
    ...layout.edges.entries(),
    ...getExpandedChildEdges(layout)
  ];

  for (const group of groups) {
    const categoryValue = group.categoryValueRef;
    const groupId = typeof group.id === 'string' ? group.id : undefined;
    const memberShapes = shapes.filter(([ element ]) => {
      return referencesCategoryValue(element, categoryValue);
    });
    const memberEdges = edges.filter(([ element ]) => {
      return referencesCategoryValue(element, categoryValue);
    });
    const points = [
      ...memberShapes.flatMap(([ , rect ]) => [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height }
      ]),
      ...memberEdges.flatMap(([ , waypoints ]) => waypoints)
    ];

    if (!points.length) {
      warnings.push(new LayoutWarning(
        'GROUP_MEMBERS_NOT_FOUND',
        groupId,
        `Group ${ groupId } has no visible explicitly referenced members and was omitted.`
      ));
      continue;
    }

    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));

    layout.shapes.set(group, bounds(
      minX - GROUP_PADDING,
      minY - GROUP_PADDING,
      maxX - minX + 2 * GROUP_PADDING,
      maxY - minY + 2 * GROUP_PADDING
    ));
  }

  return warnings;
}

function referencesCategoryValue(
    element: BpmnElement,
    categoryValue: ModdleElement<BpmnCategoryValue> | undefined
): boolean {
  if (!categoryValue) {
    return false;
  }

  const references = 'categoryValueRef' in element &&
    Array.isArray(element.categoryValueRef)
    ? element.categoryValueRef.filter(isBpmnElement)
    : [];

  return references.some(reference => {
    return reference === categoryValue ||
      reference.id === categoryValue.id;
  });
}
