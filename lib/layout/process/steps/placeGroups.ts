import { layoutGroups } from '../../groups/LayoutGroups.js';

import type { ProcessLayoutContext } from '../../Types.js';

export function placeGroups(context: ProcessLayoutContext): ProcessLayoutContext {
  context.warnings.push(
    ...layoutGroups(context.elements.groups, context.layout)
  );

  return context;
}
