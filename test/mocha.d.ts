declare module 'mocha' {
  export function describe(title: string, callback: () => void): void;
  export function beforeEach(callback: () => void | Promise<void>): void;
  export function afterEach(callback: () => void | Promise<void>): void;
  export function it(title: string, callback: () => void | Promise<void>): void;
}
