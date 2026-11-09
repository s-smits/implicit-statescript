import { RuleTester } from "../../test/rule-tester.ts";

import { preferStateUnionRule } from "./prefer-state-union.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const record = { messageId: "record" };
const parameters = { messageId: "parameters" };
const lifecycle = { messageId: "lifecycle" };
const derived = { messageId: "derived" };

/** The two shapes read from what the code does with its flags, each beside its nearest miss. */
const SHAPES = `export class Container { // REPORT a lifecycle: two flags moved by different methods
  private started = false;
  private closed: boolean = false;
  constructor(private readonly name: string) {}
  start(): void {
    if (this.closed) throw new Error(this.name);
    this.started = true;
  }
  close = (): void => {
    this.closed = true;
  };
}
export class Keys { // ADMITTED modifier keys the same handlers move together
  shift = false;
  alt = false;
  down(event: { shiftKey: boolean; altKey: boolean }): void {
    this.shift = event.shiftKey;
    this.alt = event.altKey;
  }
  up(event: { shiftKey: boolean; altKey: boolean }): void {
    this.shift = event.shiftKey;
    this.alt = event.altKey;
  }
}
export class Environment { // ADMITTED configuration only the constructor sets, beside one moved flag
  skipFsCheck: boolean;
  watching = false;
  closing = false;
  constructor(skip: boolean) {
    this.skipFsCheck = skip;
    this.watching = !skip;
  }
  close(): void {
    this.closing = true;
  }
}
export interface Element { // ADMITTED independent properties of a record are a type, not a phase
  isDeleted: boolean;
  locked: boolean;
  frozen: boolean;
}
export const isOver = (h: boolean, v: boolean): { either: boolean; horizontal: boolean; vertical: boolean } => { // REPORT a flag derived from two others
  const either = h || v;
  return { either, horizontal: h, vertical: v };
};
export function cut(code: number, signal: string | null) {
  return { ok: code === 0, killed: signal !== null, failed: code !== 0 && signal !== null }; // ADMITTED derived from no field of the record
}
export function settle(code: number) {
  const ok = code === 0;
  const late = !ok;
  return { ok, late, done: ok || late }; // REPORT derived through consts from two flags
}
export function label(title: string, name: string) {
  return { title, name, shown: title || name }; // ADMITTED a default, not a flag
}
export function open(options: { minify: boolean; sourcemap: boolean }) {
  return { minify: options.minify, sourcemap: options.sourcemap, watch: false }; // ADMITTED independent options
}
`;

/** Members that never change are no flags; a readonly flag the constructor computes still is. */
const CONSTANTS = `export interface Procedure { // ADMITTED a brand typed as one literal is no flag
  procedure: true;
  query: boolean;
  mutation: boolean;
}
export class Namespace { // ADMITTED fields that never move are no flags
  declare isNamespace: true;
  readonly isCluster = false;
  readonly lazy: boolean = true;
  deoptimized = false;
}
export class Declarator { // REPORT readonly and declared flags the constructor computes still count
  readonly isUsing: boolean;
  readonly isAwaitUsing: boolean;
  declare isConst: boolean;
  constructor(kind: string) {
    this.isUsing = kind === "using";
    this.isAwaitUsing = kind === "await using";
    this.isConst = kind === "const";
  }
}
`;

const BOOLS = `import { useState } from "react";
export interface Upload { // REPORT four required flags spell one state
  pending: boolean;
  sending: boolean;
  sent: true | false;
  failed: boolean | undefined;
}
export interface BuildOptions { // ADMITTED optional settings are independent choices
  minify?: boolean;
  sourcemap?: boolean;
  watch?: boolean;
  emptyOutDir?: boolean;
}
export interface Plugin { // ADMITTED a string union is not a flag
  enforce: "pre" | "post";
  apply: "serve" | "build";
  dev: boolean;
  ssr: boolean;
}
export class Dialog { // REPORT four boolean fields
  open = false;
  closing = false;
  closed = true;
  dragging: boolean = false;
}
export function Uploader() { // REPORT four boolean useState cells
  const [isLoading, setLoading] = useState(false);
  const [isError, setError] = useState(false);
  const [isSuccess, setSuccess] = useState(false);
  const [isIdle, setIdle] = useState<boolean>(true);
  return [isLoading, isError, isSuccess, isIdle, setLoading, setError, setSuccess, setIdle];
}
export function draw(fill: boolean, stroke: boolean, shadow: boolean, dashed = false) { // REPORT four boolean parameters
  return [fill, stroke, shadow, dashed];
}
export function line(fill: boolean, stroke: boolean, shadow: boolean) { // ADMITTED three is the limit
  return [fill, stroke, shadow];
}
`;

const FOUR_PARAMETERS = `export function draw(fill: boolean, stroke: boolean, shadow: boolean, dashed = false) {
  return [fill, stroke, shadow, dashed];
}`;

tester.run("implicit-state/prefer-state-union", preferStateUnionRule, {
  valid: [
    {
      name: "optional settings are independent choices",
      code: `export interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
  watch?: boolean;
  emptyOutDir?: boolean;
}`,
    },
    {
      name: "a string union is not a flag",
      code: `export interface Plugin {
  enforce: "pre" | "post";
  apply: "serve" | "build";
  dev: boolean;
  ssr: boolean;
}`,
    },
    {
      name: "three boolean parameters are the limit",
      code: `export function line(fill: boolean, stroke: boolean, shadow: boolean) {
  return [fill, stroke, shadow];
}`,
    },
    {
      name: "a test file is not read",
      filename: "src/upload.test.tsx",
      code: BOOLS,
    },
    {
      name: "a declaration file describes another package's interface",
      filename: "types/upload.d.ts",
      code: `export interface Upload { pending: boolean; sending: boolean; sent: boolean; failed: boolean }`,
    },
    {
      name: "params: null leaves the function half to another rule",
      code: FOUR_PARAMETERS,
      options: [{ params: null }],
    },
    {
      name: "max raises the record threshold",
      code: `export interface Upload { pending: boolean; sending: boolean; sent: boolean; failed: boolean }`,
      options: [{ max: 4 }],
    },
    {
      name: "ignore leaves out the records a repository reads as settings, by name or pattern",
      code: `export interface EditorOptions { snap: boolean; grid: boolean; debug: boolean; readonly: boolean }
export type ShapeFlags = { a: boolean; b: boolean; c: boolean; d: boolean };
export class Theme { dark = false; dense = false; rounded = true; serif = false }`,
      options: [{ ignore: ["*Options", "ShapeFlags", "Theme"] }],
    },
    {
      name: "ignore names a component for its useState record and a function for its parameters",
      filename: "src/toolbar.tsx",
      code: `import { useState } from "react";
export function Toolbar() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const [c, setC] = useState(false);
  const [d, setD] = useState(false);
  return [a, b, c, d, setA, setB, setC, setD];
}
export const draw = (fill: boolean, stroke: boolean, shadow: boolean, dashed: boolean) => [fill, stroke, shadow, dashed];`,
      options: [{ ignore: ["Toolbar", "draw"] }],
    },
    {
      name: "ignore names a class for its lifecycle and a function for its derived flag",
      code: SHAPES,
      options: [{ ignore: ["Container", "isOver", "settle"] }],
    },
    {
      name: "max: null leaves the two shapes alone",
      code: `export interface Upload { pending: boolean; sending: boolean; sent: boolean; failed: boolean }`,
      options: [{ max: null }],
    },
    { name: "a test file is not read for the shapes either", filename: "src/lifecycle.test.ts", code: SHAPES },
  ],
  invalid: [
    {
      name: "the whole fixture reports the four marked records and nothing else",
      filename: "src/upload.tsx",
      code: BOOLS,
      errors: [
        { ...record, line: 2 },
        { ...record, line: 20 },
        { ...record, line: 26 },
        { ...parameters, line: 33 },
      ],
    },
    {
      name: "an object type literal holds a record too",
      code: `export type Flags = { a: boolean; b: boolean; c: boolean; d: true | false };`,
      errors: [{ ...record, line: 1 }],
    },
    {
      name: "max lowers the record threshold, where three flags are silent by default",
      code: `export interface Request { loading: boolean; failed: boolean; done: boolean }`,
      options: [{ max: 2 }],
      errors: [{ ...record, line: 1 }],
    },
    {
      name: "ignore leaves every other record reported",
      code: `export interface EditorOptions { snap: boolean; grid: boolean; debug: boolean; readonly: boolean }
export interface EditorState { idle: boolean; busy: boolean; saving: boolean; failed: boolean }`,
      options: [{ ignore: ["*Options"] }],
      errors: [{ ...record, line: 2 }],
    },
    {
      name: "a lifecycle held as flags and a flag derived from two others, and nothing else",
      filename: "src/lifecycle.ts",
      code: SHAPES,
      errors: [
        { ...lifecycle, line: 1 },
        { ...derived, line: 42 },
        { ...derived, line: 52 },
      ],
    },
    {
      name: "the shapes stand where the count is off",
      code: SHAPES,
      options: [{ max: null }],
      errors: 3,
    },
    {
      name: "brands and constants do not count, a computed readonly flag does",
      code: CONSTANTS,
      options: [{ max: 2 }],
      errors: [{ ...record, line: 12 }],
    },
    {
      name: "a class past the count whose methods also move its flags is reported once, as a lifecycle",
      code: `export class Socket {
  connecting = false;
  open = false;
  closing = false;
  closed = false;
  connect(): void {
    this.connecting = true;
  }
  close(): void {
    this.closing = true;
    this.closed = true;
  }
}`,
      errors: [{ ...lifecycle, line: 1 }],
    },
    {
      name: "params lowers the parameter threshold",
      code: `export const toggle = (open: boolean, modal: boolean) => [open, modal];`,
      options: [{ params: 1 }],
      errors: [{ ...parameters, line: 1 }],
    },
  ],
});
