/**
 * A layout-relevant BPMN structural error.
 */
export class LayoutError extends Error {
  constructor(
      public code: string,
      public elementId: string | undefined,
      message: string,
      public relatedElementIds: string[] = []
  ) {
    super(message);

    this.name = 'LayoutError';
    this.code = code;
    this.elementId = elementId;
    this.relatedElementIds = relatedElementIds;
  }
}
