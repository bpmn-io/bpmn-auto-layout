export default {
  'addToGrid': ({ element, grid, visited }) => {

    // никогда не используется
    const nextElements = [];

    const incoming = (element.incoming || [])
      .map(out => out.sourceRef)
      .filter(el => el);

    // adjust the row if it is empty
    if (incoming.length > 1) {
      grid.adjustColumnForMultipleIncoming(incoming, element);
      grid.adjustRowForMultipleIncoming(incoming, element);
    }
    return nextElements;
  },
};