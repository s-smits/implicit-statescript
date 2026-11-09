import { RuleTester } from "../../test/rule-tester.ts";

import { preferStateUnionRule } from "./prefer-state-union.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const record = { messageId: "record" };
const parameters = { messageId: "parameters" };

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
      code: `export type Flags = { a: boolean; b: boolean; c: boolean; d: true };`,
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
      name: "params lowers the parameter threshold",
      code: `export const toggle = (open: boolean, modal: boolean) => [open, modal];`,
      options: [{ params: 1 }],
      errors: [{ ...parameters, line: 1 }],
    },
  ],
});
