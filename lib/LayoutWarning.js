/**
 * A non-fatal layout diagnostic.
 */
export class LayoutWarning extends Error {
  constructor(code, elementId, message, relatedElementIds = []) {
    super(message);

    this.name = 'LayoutWarning';
    this.code = code;
    this.elementId = elementId;
    this.relatedElementIds = relatedElementIds;
  }
}
