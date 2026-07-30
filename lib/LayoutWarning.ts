/**
 * A non-fatal layout diagnostic.
 */
export class LayoutWarning extends Error {
  constructor(
      public code: string,
      public elementId: string | undefined,
      message: string,
      public relatedElementIds: string[] = []
  ) {
    super(message);

    this.name = 'LayoutWarning';
    this.code = code;
    this.elementId = elementId;
    this.relatedElementIds = relatedElementIds;
  }
}
