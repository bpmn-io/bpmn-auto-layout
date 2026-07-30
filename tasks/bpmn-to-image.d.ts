declare module 'bpmn-to-image' {
  type Conversion = {
    input: string;
    outputs: string[];
  };

  type ConvertOptions = {
    footer?: boolean;
    title?: boolean | string;
  };

  export function convertAll(
    conversions: Conversion[],
    options?: ConvertOptions
  ): Promise<void>;
}
