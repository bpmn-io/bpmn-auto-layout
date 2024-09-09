export default {
  'addToGrid': ({ element, grid, visited }) => {
    const nextElements = [];

    // Handle incoming paths
    const incoming = (element.incoming || [])
      .map(out => out.sourceRef)
      .filter(el => el);

    if (incoming.length > 1) {

      incoming.forEach((nextElement, index, arr) => {
        if (visited.has(nextElement)) {
          return;
        }

        grid.addBelow(arr[index - 1], nextElement);

        nextElements.unshift(nextElement);
        visited.add(nextElement);
      });
    }
    return nextElements;
  },
};