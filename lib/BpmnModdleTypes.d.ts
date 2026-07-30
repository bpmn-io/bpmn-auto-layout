declare module 'bpmn-moddle' {
  export type BpmnModdleReferenceWarning = Error & {
    element: import('./layout/bpmn/Types.js').BpmnElement;
    property: string;
  };

  export type BpmnModdleParseWarning =
    | Error
    | BpmnModdleReferenceWarning;

  export type BpmnModdleParseResult = {
    rootElement: import('./layout/bpmn/Types.js').BpmnElementFor<'bpmn:Definitions'>;
    warnings: BpmnModdleParseWarning[];
  };

  export type BpmnModdleSerializationOptions = {
    format?: boolean;
  };

  export type BpmnModdleSerializationResult = {
    xml: string;
  };

  export class BpmnModdle {
    constructor();

    create<Type extends import('./layout/bpmn/Types.js').BpmnDiModdleTypeName>(
      type: Type,
      attributes?: import('./layout/bpmn/Types.js').BpmnDiModdleElementAttributes<Type>
    ): import('./layout/bpmn/Types.js').BpmnDiModdleElementFor<Type>;

    fromXML(xml: string): Promise<BpmnModdleParseResult>;

    toXML(
      rootElement: import('./layout/bpmn/Types.js').BpmnElementFor<'bpmn:Definitions'>,
      options?: BpmnModdleSerializationOptions
    ): Promise<BpmnModdleSerializationResult>;
  }
}
