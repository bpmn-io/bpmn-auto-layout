import { is } from '../di/DiUtil.js';

export default {
  'addToGrid': ({ element, grid, visited }) => {
    const nextElements = [];

    // Handle incoming paths
    const incoming = (element.incoming || [])
      .map(out => out.sourceRef)
      .filter(el => el);

    // Splitting gateway would always be the same row as start event
    if (incoming.length > 1 && is(element,'bpmn:ExclusiveGateway')) {
      grid.adjustRowToStartEvent(element);

      // TODO: see about column
    }
    return nextElements;
  },
};