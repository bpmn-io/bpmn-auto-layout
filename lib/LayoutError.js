/**
 * A layout-relevant BPMN structural error.
 */
export class LayoutError extends Error {
  constructor(code, elementId, message, relatedElementIds = []) {
    super(message);

    this.name = 'LayoutError';
    this.code = code;
    this.elementId = elementId;
    this.relatedElementIds = relatedElementIds;
  }
}
