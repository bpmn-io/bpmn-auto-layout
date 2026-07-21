import { Layouter } from './Layouter.js';
export { LayoutError } from './LayoutError.js';
export { LayoutWarning } from './LayoutWarning.js';

export function layoutProcess(xml) {
  return new Layouter().layoutProcess(xml);
}
