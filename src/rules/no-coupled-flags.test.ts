import { RuleTester } from "../../test/rule-tester.ts";

import { noCoupledFlagsRule } from "./no-coupled-flags.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const mode = { messageId: "mode" };

/** An editor's instance state written through a method the `set*` convention does not name. */
const UPDATES = `export function tools(editor: { updateInstanceState(next: object): void }) {
  editor.updateInstanceState({ isToolLocked: true, isPenMode: false });
  editor.updateInstanceState({ isToolLocked: false, isPenMode: true });
  editor.updateInstanceState({ isToolLocked: false, isPenMode: false });
}`;

const MODES = `import { useState } from "react";
export function Loader() {
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  async function load() {
    setIsLoading(true); // REPORT three setters, at most one set each time
    setIsError(false);
    setIsSuccess(false);
    try {
      await fetch("/data");
      setIsLoading(false);
      setIsSuccess(true);
      setIsError(false);
    } catch {
      setIsLoading(false);
      setIsError(true);
      setIsSuccess(false);
    }
  }
  return [isLoading, isError, isSuccess, load];
}
export class Canvas {
  state = { isResizing: false, isRotating: false, editingElement: null as string | null };
  setState(next: Partial<Canvas["state"]>) {
    this.state = { ...this.state, ...next };
  }
  resize() {
    this.setState({ isResizing: true, isRotating: false, editingElement: null }); // REPORT a drawing tool's mode
  }
  rotate() {
    this.setState({ isResizing: false, isRotating: true, editingElement: null });
  }
  edit(element: string) {
    this.setState({ isResizing: false, isRotating: false, editingElement: element });
  }
  idle() {
    this.setState({ isResizing: false, isRotating: false, editingElement: null });
  }
}
export function build(run: (options: object) => void) {
  run({ minify: true, sourcemap: false }); // ADMITTED options created whole are independent choices
  run({ minify: false, sourcemap: true });
  run({ minify: true, sourcemap: false });
}
export function track(point: { x: number; y: number }, setPoint: (next: object) => void) {
  setPoint({ ...point, x: 1, y: 2 }); // ADMITTED both fields set together, no mode
  setPoint({ ...point, x: 3, y: 0 });
  setPoint({ ...point, x: 5, y: 8 });
}
export function clear(store: { open: boolean; dirty: boolean }) {
  store.open = false; // ADMITTED a reset clears every field and shows no mode
  store.dirty = false;
}
export function clearAgain(store: { open: boolean; dirty: boolean }) {
  store.open = false;
  store.dirty = false;
}
export function clearOnce(store: { open: boolean; dirty: boolean }) {
  store.open = false;
  store.dirty = false;
}
`;

tester.run("implicit-state/no-coupled-flags", noCoupledFlagsRule, {
  valid: [
    {
      name: "options created whole and passed on are independent choices",
      code: `export function build(run: (options: object) => void) {
  run({ minify: true, sourcemap: false });
  run({ minify: false, sourcemap: true });
  run({ minify: true, sourcemap: false });
}`,
    },
    {
      name: "fields set together are no mode",
      code: `export function track(point: { x: number; y: number }, setPoint: (next: object) => void) {
  setPoint({ ...point, x: 1, y: 2 });
  setPoint({ ...point, x: 3, y: 0 });
  setPoint({ ...point, x: 5, y: 8 });
}`,
    },
    {
      name: "a reset that clears every field shows no mode",
      code: `export function clear(store: { open: boolean; dirty: boolean }) {
  store.open = false;
  store.dirty = false;
}
export function clearAgain(store: { open: boolean; dirty: boolean }) {
  store.open = false;
  store.dirty = false;
}
export function clearOnce(store: { open: boolean; dirty: boolean }) {
  store.open = false;
  store.dirty = false;
}`,
    },
    { name: "fields: 4 asks for a larger cluster", filename: "src/four.tsx", code: MODES, options: [{ fields: 4 }] },
    { name: "writes: 5 asks for more co-writes", filename: "src/many.tsx", code: MODES, options: [{ writes: 5 }] },
    { name: "a test file is not read", filename: "src/modes.spec.tsx", code: MODES },
    { name: "a method outside the set* convention writes nothing by default", code: UPDATES },
  ],
  invalid: [
    {
      name: "the whole fixture reports the setter run and the drawing tool, and nothing else",
      filename: "src/modes.tsx",
      code: MODES,
      errors: [
        { ...mode, line: 7 },
        { ...mode, line: 29 },
      ],
    },
    {
      name: "fields of one object assigned in runs of statements",
      code: `export function drive(tool: { isResizing: boolean; isRotating: boolean }) {
  tool.isResizing = true;
  tool.isRotating = false;
}
export function turn(tool: { isResizing: boolean; isRotating: boolean }) {
  tool.isResizing = false;
  tool.isRotating = true;
}
export function rest(tool: { isResizing: boolean; isRotating: boolean }) {
  tool.isResizing = false;
  tool.isRotating = false;
}`,
      errors: [{ ...mode, line: 2 }],
    },
    {
      name: "setters names a repository's own writer, by name or pattern",
      code: UPDATES,
      options: [{ setters: ["update*State"] }],
      errors: [{ ...mode, line: 2 }],
    },
  ],
});
