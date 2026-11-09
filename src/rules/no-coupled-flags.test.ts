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
export function nodes(flags: number, notes: string[]) {
  return [
    { ...(notes.length > 0 ? { notes } : {}), sync: (flags & 1) === 1, id: null }, // ADMITTED a spread of a fresh object updates no state
    { ...(notes.length > 0 ? { notes } : {}), sync: false, id: flags },
    { ...(notes.length > 0 ? { notes } : {}), sync: (flags & 2) === 2, id: null },
  ];
}
export function reduce(view: { dragging: boolean; typing: boolean }, action: string) {
  if (action === "drag") return { ...view, dragging: true, typing: false }; // REPORT a reducer's mode over the state it spreads
  if (action === "type") return { ...view, dragging: false, typing: true };
  return { ...view, dragging: false, typing: false };
}
`;

/** Modes shown without a count: comparisons that cannot both hold, and opposite literals. */
const UNCOUNTED = `export class Tool {
  setState(next: object) {
    return next;
  }
  start(handle: string | null) {
    this.setState({ // REPORT complementary comparisons of one handle
      isResizing: handle !== null && handle !== "rotation",
      isRotating: handle === "rotation",
    });
  }
}
export function kinds(kind: string, other: string) {
  const one = { isFile: kind === "file", isDir: kind === "dir" }; // REPORT one subject equal to two literals
  const two = { isFile: kind === "file", isLink: other === "link" }; // ADMITTED two subjects
  const three = { ready: kind !== "", named: kind !== "anon" }; // ADMITTED both can hold
  return [one, two, three];
}
export function origins(digest: string) {
  return [
    { digest, imported: false, frozen: false },
    { digest, imported: true, frozen: false }, // REPORT opposite literals, never both set
    { digest, imported: false, frozen: true },
  ];
}
export function marks(digest: string) {
  return [
    { digest, open: true, dirty: false }, // ADMITTED both set in another object
    { digest, open: false, dirty: true },
    { digest, open: true, dirty: true },
  ];
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
    {
      name: "a spread of a fresh object updates no state",
      code: `export function nodes(flags: number, notes: string[]) {
  return [
    { ...(notes.length > 0 ? { notes } : {}), sync: (flags & 1) === 1, id: null },
    { ...(notes.length > 0 ? { notes } : {}), sync: false, id: flags },
    { ...(notes.length > 0 ? { notes } : {}), sync: (flags & 2) === 2, id: null },
  ];
}`,
    },
    {
      name: "comparisons of two subjects, or that can both hold, show no mode",
      code: `export function kinds(kind: string, other: string) {
  const two = { isFile: kind === "file", isLink: other === "link" };
  const three = { ready: kind !== "", named: kind !== "anon" };
  return [two, three];
}`,
    },
    {
      name: "opposite literals that are both true in another object show no mode",
      code: `export function marks(digest: string) {
  return [
    { digest, open: true, dirty: false },
    { digest, open: false, dirty: true },
    { digest, open: true, dirty: true },
  ];
}`,
    },
    {
      name: "opposite literals in objects handed straight to a call are options",
      code: `export function build(run: (options: object) => void) {
  run({ minify: true, sourcemap: false });
  run({ minify: false, sourcemap: true });
}`,
    },
  ],
  invalid: [
    {
      name: "the whole fixture reports the setter run, the drawing tool and the reducer, and nothing else",
      filename: "src/modes.tsx",
      code: MODES,
      errors: [
        { ...mode, line: 7 },
        { ...mode, line: 29 },
        { ...mode, line: 71 },
      ],
    },
    {
      name: "comparisons that cannot both hold and opposite literals are modes without a count",
      filename: "src/shapes.ts",
      code: UNCOUNTED,
      errors: [
        { messageId: "exclusive", line: 6 },
        { messageId: "exclusive", line: 13 },
        { messageId: "opposite", line: 21 },
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
