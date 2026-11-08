// Minimal typings for the node test runner, avoids depending on @types/node.

declare module "node:test" {
  type Fn = () => void | Promise<void>;
  export function describe(name: string, fn: Fn): void;
  export function it(name: string, fn: Fn): void;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
    doesNotMatch(value: string, regexp: RegExp, message?: string): void;
  };
  export default assert;
}

declare const console: {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};

// Stubbed at runtime by tests/support/gi-stubs.mjs.
// Each module needs both a namespace (for type positions like `win: Meta.Window`)
// and a const any (for value positions like `Meta.WindowType.NORMAL`).
declare module "gi://GLib" {
  const GLib: any;
  export default GLib;
}

declare module "gi://Meta" {
  namespace Meta {
    type Window = any;
    type WindowType = any;
  }
  const Meta: any;
  export default Meta;
}

declare module "gi://Gio" {
  namespace Gio {
    type File = any;
    type AppInfo = any;
  }
  const Gio: any;
  export default Gio;
}

declare module "gi://GioUnix" {
  namespace GioUnix {
    type DesktopAppInfo = any;
  }
  const GioUnix: any;
  export default GioUnix;
}

declare module "gi://GObject" {
  namespace GObject {
    type Object = any;
  }
  const GObject: any;
  export default GObject;
}
