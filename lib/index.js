import { Layouter } from './Layouter.js';
export { LayoutError } from './LayoutError.js';

export function layoutProcess(xml) {
  return new Layouter().layoutProcess(xml);
}
