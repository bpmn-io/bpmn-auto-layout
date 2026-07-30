import 'moddle';

declare module 'moddle' {
  interface ModdleTypeMap {
    [type: string]: ModdleElement;
  }

  type ModdleElement<T extends object = object> = T & {
    $instanceOf(type: string): boolean;
    $parent?: ModdleElement;
    $type: string;
  };
}
