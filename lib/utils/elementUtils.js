import { is } from '../di/DiUtil.js';

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

export function getOutgoingElements(element) {
  let outgoing = new Set();
  if (element) {
    const selfOutgoing = (element.outgoing || [])
      .map(out => out.targetRef)
      .filter(el => el);
    selfOutgoing.forEach(out => outgoing.add(out));
  }
  return [ ...outgoing ];
}

export function getIncomingElements(element) {
  let incoming = [];

  if (element) {
    incoming = (element.incoming || [])
      .map(out => out.sourceRef)
      .filter(el => el)
      .map(item => {
        if (item.attachedToRef) {
          return item.attachedToRef;
        } else {
          return item;
        }
      });
  }

  // there is no time to check, so here it is
  const unique = new Set(incoming);

  return [ ...unique ];
}

export function getAttachedOutgoingElements(element) {
  const outgoing = new Set();
  if (element) {
    const attachedOutgoing = (element.attachers || [])
      .map(attacher => (attacher.outgoing || []).reverse())
      .flat()
      .map(out => out.targetRef)
      .filter((item, index, self) => self.indexOf(item) === index);
    for (const out of attachedOutgoing) {
      outgoing.add(out);
    }
  }

  return [ ...outgoing ];
}

export function getAdjacentElements(element) {
  const allElements = new Set();
  if (element) {
    getIncomingElements(element).forEach(el => allElements.add(el));
    getOutgoingElements(element).forEach(out => allElements.add(out));
    getAttachedOutgoingElements(element).forEach(out => allElements.add(out));
  }

  return [ ...allElements ];
}

export function isStartIntermediate(element) {
  return (is(element, 'bpmn:IntermediateThrowEvent') || is(element, 'bpmn:IntermediateCatchEvent'))
      && (element.incoming === undefined || element.incoming.length === 0);
}
