import { layoutGroups } from '../../groups/LayoutGroups.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function placeGroups(context) {
  context.warnings.push(
    ...layoutGroups(context.elements.groups, context.layout)
  );

  return context;
}
