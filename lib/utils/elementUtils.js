export function isConnection(element) {
  return !!element.sourceRef;
}

export function isBoundaryEvent(element) {
  return !!element.attachedToRef;
}

export function findElementInTree(currentElement, targetElement, visited = new Set()) {

  if (currentElement === targetElement) return true;

  if (visited.has(currentElement)) return false;

  visited.add(currentElement);

  // If currentElement has no outgoing connections, return false
  if (!currentElement.outgoing || currentElement.outgoing.length === 0) return false;

  // Recursively check each outgoing element
  for (let nextElement of currentElement.outgoing.map(out => out.targetRef)) {
    if (findElementInTree(nextElement, targetElement, visited)) {
      return true;
    }
  }

  return false;
}
