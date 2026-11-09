/**
 * The survey's first half: read a repository and propose the facts the rules and the scan take as
 * options, each with the evidence it rests on. Nothing here decides; a person adopts a fact or not,
 * and `survey-hits.ts` shows which hits each one would add or remove.
 *
 * Every candidate is read off the syntax and, where the question is about types, the TypeScript
 * checker over the same files (no library loaded, relative imports alone, as the scan reads them).
 * A name (`*State`, `isFile`, `updateX`) only ranks a candidate beside that reading: on a labelled
 * corpus, state detection by name alone was right on 2 of 29 hits.
 *
 * - Wrappers: a function of at most a few statements whose body forwards a parameter to the
 *   platform and hands back its answer: an existence check (`existsSync`, `access`,
 *   `stat(...).isFile()`) for `no-marker-file-state.fsWrappers`, a file time (`stat(...).mtimeMs`)
 *   for `no-age-based-lock.fsWrappers`, or the process table (`kill(pid, 0)`, a spawn of `ps`) for
 *   `no-age-based-lock.processReaders`. Its callers are those in its file or importing its name, and
 *   a name another function also declares is passed over, since an option matches calls by name.
 *   A wrapper of `git` and a lock or marker helper are noted, since no option reads them.
 * - Setters: a function or method outside the `set*` convention, whose result its callers discard,
 *   handed objects whose boolean fields change from call to call, for `no-coupled-flags.setters`.
 * - Settings records: a record with more than three required booleans none of whose members is
 *   written in an update the checker traces to it, for `prefer-state-union.ignore`; where three or
 *   more such records share a last word (`*Options`), the pattern is proposed in their place.
 * - State folders: a folder holding a file written as JSON and read back, for
 *   `no-marker-file-state.stateDirs`; a manifest (`package.json`) is no state and is left out.
 * - State types: an exported set of string literals the checker reads as written in an update,
 *   grouped by hand outside its file, for the scan's `stateTypes`.
 * - Owners: an exported function the checker types as returning a boolean or a literal union, whose
 *   body groups literals over a parameter's field, for the scan's `owners`.
 */
import * as ts from "typescript5";
import { isTestPath, setterState } from "../shared/syntax.ts";
import { type Declared, declaredSets, functionName, type Grouping, groupingsIn, parsedSources, quoted } from "./scattered-literals.ts";
import { checkerOver, lastWord, stateWrites } from "./state-role.ts";

/** A file, a line and the text that starts there. */
export interface Evidence {
  path: string;
  line: number;
  text: string;
}

/** Where an adopted fact is written: a rule's option, or the scan's setting. */
export const TARGETS = [
  "prefer-state-union.ignore",
  "no-coupled-flags.setters",
  "no-marker-file-state.fsWrappers",
  "no-marker-file-state.stateDirs",
  "no-age-based-lock.fsWrappers",
  "no-age-based-lock.processReaders",
  "scan.stateTypes",
  "scan.owners",
] as const;
export type Target = (typeof TARGETS)[number];

/** One fact the survey proposes. */
export interface Proposal {
  target: Target;
  value: string;
  why: string;
  /** Higher first: the strength of the evidence, then the name as a weaker signal. */
  score: number;
  evidence: Evidence[];
}

/** A fact the survey found that no option reads, for the person to know of. */
export interface Noted {
  what: string;
  evidence: Evidence[];
}

/** One function the survey can read: its name, its node and where it is. */
interface Fn {
  name: string;
  node: ts.SignatureDeclaration & { body?: ts.Node | undefined };
  file: ts.SourceFile;
  exported: boolean;
}

const EXISTS = new Set(["existsSync", "pathExists", "pathExistsSync", "access", "accessSync"]);
const STATS = new Set(["stat", "statSync", "lstat", "lstatSync"]);
const TIMES = new Set(["mtimeMs", "mtime", "ctimeMs", "ctime", "lastModified"]);
const KINDS = new Set(["isFile", "isDirectory"]);
const SPAWNS = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "execa", "execaSync", "execaCommand"]);
const JSON_WRITES = new Set(["writeJson", "writeJsonSync", "writeJSON", "writeJSONSync", "outputJson", "outputJsonSync", "writeJsonFile", "writeJsonFileSync"]);
const TEXT_WRITES = new Set(["writeFileSync", "writeFile", "outputFile", "outputFileSync", "write"]);
const JSON_READS = new Set(["readJson", "readJsonSync", "readJSON", "readJSONSync", "readJsonFile", "readJsonFileSync", "loadJsonFile", "loadJsonFileSync"]);
const TEXT_READS = new Set(["readFileSync", "readFile"]);
const JOINS = new Set(["join", "resolve"]);
/** Statements a wrapper may hold: it forwards, so it is short. */
const WRAPPER_STATEMENTS = 4;
/** Booleans a record may hold before `prefer-state-union` reads it, at its default. */
const RECORD_FLAGS = 3;

const PROCESS_TABLE = /^(?:ps|pgrep|pidof|tasklist)\b/u;
const GIT = /^git\b/u;
/** Ranking signals only: names that read as a state, a writer, settings, a check or a lock. */
const STATE_NAME = /(?:state|status|phase|mode|stage)$/iu;
const WRITER_NAME = /^(?:update|patch|merge|assign|apply|change|put|commit|dispatch)/iu;
const SETTINGS_NAME = /(?:Options|Opts|Config|Props|Settings|Flags|Info|Event|Features)$/u;
const CHECK_NAME = /exist|^has|^is|alive|running|mtime|age|lock/iu;
/** Words of a name (`takeLock` is `take` and `lock`) that read as a lock or marker helper. */
const LOCK_WORDS = new Set(["lock", "locks", "marker", "markers", "sentinel", "stamp", "pidfile"]);
/** Calls that touch the file system, which a lock or marker helper makes. */
const FS_TOUCHES = new Set([
  "open",
  "openSync",
  "writeFile",
  "writeFileSync",
  "mkdir",
  "mkdirSync",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "rename",
  "renameSync",
  "link",
  "linkSync",
  ...EXISTS,
  ...STATS,
]);
/** Files a tool writes and reads back as its manifest or settings, which are no state of the program. */
const MANIFESTS = new Set(["package.json", "tsconfig.json", "jsconfig.json"]);
/** Folder words that name no folder in particular, left out of `stateDirs` proposals. */
const GENERIC_FOLDER = new Set(["dir", "dirname", "root", "cwd", "path", "base", "folder", "tmp", "temp", "directory", "opts", "options", "this", "config", "process"]);

const lineOf = (file: ts.SourceFile, node: ts.Node): number => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

/** A file's path in the tree. Building a program renames each file it reads under the checker's
 *  root (`/src/a.ts`), so the path is read back without it. */
const pathOf = (file: ts.SourceFile): string => file.fileName.replace(/^\//u, "");

function evidenceAt(file: ts.SourceFile, node: ts.Node): Evidence {
  const text = (node.getText(file).split("\n")[0] ?? "").trim();
  return { path: pathOf(file), line: lineOf(file, node), text: text.length > 120 ? `${text.slice(0, 117)}...` : text };
}

/** The name a call reaches: `f` for `f()` and `a.b.f()`, or null for any other callee. */
function calleeOf(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
}

/** Every node under `root`, depth first, as a list. */
function nodesUnder(root: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** Every named function of the files, with whether its file exports it. */
function functionsOf(parsed: readonly (readonly [string, ts.SourceFile])[]): Fn[] {
  return parsed.flatMap(([, file]) =>
    nodesUnder(file).flatMap((node): Fn[] => {
      const name = ts.isFunctionLike(node) ? functionName(node) : null;
      if (name === null || !ts.isFunctionLike(node)) {
        return [];
      }
      const statement = ts.isFunctionDeclaration(node) ? node : node.parent.parent?.parent;
      const modifiers = statement !== undefined && ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
      const exported = modifiers.some((one) => one.kind === ts.SyntaxKind.ExportKeyword);
      return [{ name, node: node as Fn["node"], file, exported }];
    }),
  );
}

/** Where each name is called, over every file, with the names each file imports. */
function callSites(parsed: readonly (readonly [string, ts.SourceFile])[]): { sites: Map<string, Evidence[]>; imports: Map<string, Set<string>> } {
  const sites = new Map<string, Evidence[]>();
  const imports = new Map<string, Set<string>>();
  for (const [, file] of parsed) {
    const imported = new Set<string>();
    for (const node of nodesUnder(file)) {
      if (ts.isImportSpecifier(node) || ts.isImportClause(node)) {
        imported.add((ts.isImportSpecifier(node) ? (node.propertyName ?? node.name) : node.name)?.getText(file) ?? "");
      }
      const name = ts.isCallExpression(node) ? calleeOf(node) : null;
      if (name !== null) {
        sites.set(name, [...(sites.get(name) ?? []), evidenceAt(file, node)]);
      }
    }
    imports.set(pathOf(file), imported);
  }
  return { sites, imports };
}

/** An expression with parentheses, `await`, `!` and `.catch(...)` or `.then(...)` climbed off. */
function unwrapped(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isNonNullExpression(node)) {
    return unwrapped(node.expression);
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return unwrapped(node.operand);
  }
  const chained = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["catch", "then"].includes(node.expression.name.text);
  return chained ? unwrapped((node.expression as ts.PropertyAccessExpression).expression) : node;
}

/** What a function hands back: its concise body, or each `return`'s expression outside nested functions. */
function handedBack(body: ts.Node): ts.Expression[] {
  if (!ts.isBlock(body)) {
    return [body as ts.Expression];
  }
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      found.push(node.expression);
    }
    if (!ts.isFunctionLike(node)) {
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(body, visit);
  return found;
}

/** What a short function forwards its parameter to, or null where it is no wrapper. */
function wrapped(fn: Fn): "exists" | "time" | "process" | "git" | null {
  const body = fn.node.body;
  if (body === undefined || (ts.isBlock(body) && body.statements.length > WRAPPER_STATEMENTS)) {
    return null;
  }
  const parameters = new Set(fn.node.parameters.flatMap((one) => nodesUnder(one.name).filter(ts.isIdentifier).map((name) => name.text)));
  const named = (one: ts.Node): boolean =>
    ts.isIdentifier(one) && parameters.has(one.text) && !(ts.isPropertyAccessExpression(one.parent) && one.parent.name === one);
  const usesParameter = (node: ts.Node): boolean => nodesUnder(node).some(named);
  const nodes = nodesUnder(body);
  const calls = nodes.filter(ts.isCallExpression);
  const reads = new Set(nodes.filter(ts.isPropertyAccessExpression).map((one) => one.name.text));
  const forwards = (names: ReadonlySet<string>): boolean =>
    calls.some((call) => names.has(calleeOf(call) ?? "") && call.arguments.some(usesParameter));
  const spawned = calls.flatMap((call) => {
    const [first] = call.arguments;
    return SPAWNS.has(calleeOf(call) ?? "") && first !== undefined && ts.isStringLiteralLike(first) ? [first.text] : [];
  });
  // An existence check is what the wrapper hands back, or the `true` and `false` around it; a body
  // that checks first and then reads (`existsSync(p) ? readFileSync(p) : ""`) is a reader.
  const answers = (one: ts.Expression): boolean => {
    const at = unwrapped(one);
    const call = ts.isCallExpression(at) ? (calleeOf(at) ?? "") : "";
    return at.kind === ts.SyntaxKind.TrueKeyword || at.kind === ts.SyntaxKind.FalseKeyword || EXISTS.has(call) || KINDS.has(call);
  };
  const answer = handedBack(body);
  if ((forwards(EXISTS) || (forwards(STATS) && [...KINDS].some((one) => reads.has(one)))) && answer.length > 0 && answer.every(answers)) {
    return "exists";
  }
  // Likewise a file's time is what it hands back, not a step on the way to removing the file.
  const timed = (one: ts.Expression): boolean => nodesUnder(one).some((at) => ts.isPropertyAccessExpression(at) && TIMES.has(at.name.text));
  if (forwards(STATS) && answer.length > 0 && answer.every(timed)) {
    return "time";
  }
  const kills = calls.some((call) => calleeOf(call) === "kill" && call.arguments[1]?.getText(fn.file) === "0");
  if (kills || spawned.some((one) => PROCESS_TABLE.test(one))) {
    return "process";
  }
  return spawned.some((one) => GIT.test(one)) ? "git" : null;
}

/** Whether a function is named as a lock or marker helper and touches the file system. */
function locksOrMarks(fn: Fn): boolean {
  const words = fn.name.split(/(?=[A-Z])|[\d$_]+/u).map((word) => word.toLowerCase());
  const body = fn.node.body;
  return words.some((word) => LOCK_WORDS.has(word)) && body !== undefined && nodesUnder(body).some((one) => ts.isCallExpression(one) && FS_TOUCHES.has(calleeOf(one) ?? ""));
}

/**
 * Wrappers of the platform, proposed by what they forward to; `git` wrappers and lock helpers are
 * noted. A caller counts in the wrapper's own file or in a file that imports its name, and a name
 * another function also declares is not proposed, since the option matches every call by name.
 */
function wrappers(functions: readonly Fn[], calls: ReturnType<typeof callSites>): { proposals: Proposal[]; noted: Noted[] } {
  const proposals: Proposal[] = [];
  const noted: Noted[] = [];
  const seen = new Set<string>();
  const declared = Map.groupBy(functions, (one) => one.name);
  for (const fn of functions) {
    const kind = EXISTS.has(fn.name) || STATS.has(fn.name) ? null : wrapped(fn);
    const own = pathOf(fn.file);
    const reaches = (site: Evidence): boolean => (site.path === own ? kind !== "exists" : fn.exported && (calls.imports.get(site.path)?.has(fn.name) ?? false));
    const callers = (calls.sites.get(fn.name) ?? []).filter(reaches);
    const at = evidenceAt(fn.file, fn.node);
    if (kind === "git" || (kind === null && locksOrMarks(fn))) {
      noted.push({ what: kind === "git" ? `\`${fn.name}\` wraps git` : `\`${fn.name}\` reads as a lock or marker helper`, evidence: [at] });
    }
    const shared = (declared.get(fn.name) ?? []).some((other) => other !== fn && wrapped(other) !== kind);
    if (kind === null || kind === "git" || shared || callers.length === 0 || seen.has(`${kind} ${fn.name}`)) {
      continue;
    }
    seen.add(`${kind} ${fn.name}`);
    const target: Target = kind === "exists" ? "no-marker-file-state.fsWrappers" : kind === "time" ? "no-age-based-lock.fsWrappers" : "no-age-based-lock.processReaders";
    const does = kind === "exists" ? "asks whether a path exists" : kind === "time" ? "returns a file's time" : "asks the process table";
    const why = `forwards its parameter to the platform and ${does}; called in ${places(callers.length)}${kind === "exists" ? " in other files" : ""}`;
    const score = Math.min(callers.length, 20) + (CHECK_NAME.test(fn.name) ? 2 : 0);
    proposals.push({ target, value: fn.name, why, score, evidence: [at, ...callers.slice(0, 3)] });
  }
  return { proposals, noted };
}

/** Whether a node is a literal that writes a flag: `true`, `false`, `null` or `undefined`. */
const flagLiteral = (node: ts.Node): boolean =>
  node.kind === ts.SyntaxKind.TrueKeyword ||
  node.kind === ts.SyntaxKind.FalseKeyword ||
  node.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isIdentifier(node) && node.text === "undefined");

/** The node a call stands as once `await`, `void` and parentheses are climbed. */
function standing(call: ts.Node): ts.Node {
  let at = call.parent;
  while (ts.isAwaitExpression(at) || ts.isVoidExpression(at) || ts.isParenthesizedExpression(at)) {
    at = at.parent;
  }
  return at;
}

/** Functions and methods outside the `set*` convention handed objects whose flags change call to call. */
function setters(parsed: readonly (readonly [string, ts.SourceFile])[]): Proposal[] {
  const byName = new Map<string, { at: Evidence[]; values: Map<string, Set<string>> }>();
  for (const [, file] of parsed) {
    for (const call of nodesUnder(file).filter(ts.isCallExpression)) {
      // A write's result is discarded, so a call whose value is used (a query handed options) is
      // none; nor is the platform's own `Object.defineProperty` with its descriptor.
      const name = calleeOf(call);
      const object = call.arguments.find(ts.isObjectLiteralExpression);
      const platform = ts.isPropertyAccessExpression(call.expression) && /^(?:Object|Reflect)$/u.test(call.expression.expression.getText(file));
      if (name === null || object === undefined || setterState(name) !== null || platform || !ts.isExpressionStatement(standing(call))) {
        continue;
      }
      const flags = object.properties.filter((one) => ts.isPropertyAssignment(one) && flagLiteral(one.initializer)) as ts.PropertyAssignment[];
      if (flags.length < 2) {
        continue;
      }
      const entry = byName.get(name) ?? { at: [], values: new Map<string, Set<string>>() };
      entry.at.push(evidenceAt(file, call));
      for (const flag of flags) {
        const key = flag.name.getText(file);
        entry.values.set(key, (entry.values.get(key) ?? new Set()).add(flag.initializer.getText(file)));
      }
      byName.set(name, entry);
    }
  }
  return [...byName].flatMap(([name, { at, values }]): Proposal[] => {
    const varying = [...values].filter(([, seen]) => seen.size > 1).map(([key]) => key);
    if (at.length < 3 || varying.length < 2) {
      return [];
    }
    const why = `handed ${String(at.length)} objects whose flags ${varying.slice(0, 4).join(", ")} change from call to call`;
    return [{ target: "no-coupled-flags.setters", value: name, why, score: Math.min(at.length, 20) + (WRITER_NAME.test(name) ? 5 : 0), evidence: at.slice(0, 4) }];
  });
}

/** Whether a type node is the literal `true` or `false`. */
const booleanLiteral = (one: ts.TypeNode): boolean =>
  ts.isLiteralTypeNode(one) && [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(one.literal.kind);

/** Whether an annotation is a flag: `boolean`, `true` or `false`, with `undefined` or `null` beside. */
function flagAnnotation(type: ts.TypeNode | undefined): boolean {
  if (type === undefined) {
    return false;
  }
  // One literal alone (`ready: true`) is a brand or a discriminant, which the rule leaves out.
  if (!ts.isUnionTypeNode(type)) {
    return type.kind === ts.SyntaxKind.BooleanKeyword;
  }
  const empty = [ts.SyntaxKind.UndefinedKeyword, ts.SyntaxKind.VoidKeyword];
  const kept = type.types.filter((one) => !empty.includes(one.kind) && !(ts.isLiteralTypeNode(one) && one.literal.kind === ts.SyntaxKind.NullKeyword));
  return kept.length > 0 && kept.every((one) => one.kind === ts.SyntaxKind.BooleanKeyword || booleanLiteral(one));
}

/** The required boolean members of a record, by name, as `prefer-state-union` counts them. */
function recordFlags(node: ts.Node, file: ts.SourceFile): string[] {
  const literal = ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type) ? node.type.members : [];
  const members: readonly ts.Node[] = ts.isInterfaceDeclaration(node) || ts.isClassLike(node) ? node.members : literal;
  return members.flatMap((member) => {
    const property = ts.isPropertySignature(member) || ts.isPropertyDeclaration(member) ? member : null;
    const isStatic = property !== null && ts.isPropertyDeclaration(property) && ts.getModifiers(property)?.some((one) => one.kind === ts.SyntaxKind.StaticKeyword);
    if (property === null || property.questionToken !== undefined || isStatic === true) {
      return [];
    }
    const initial = ts.isPropertyDeclaration(property) ? property.initializer : undefined;
    const flagged = initial !== undefined && [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(initial.kind);
    // A `readonly` field given a literal is a constant, which the rule leaves out.
    const constant = flagged && ts.getModifiers(property)?.some((one) => one.kind === ts.SyntaxKind.ReadonlyKeyword) === true;
    return !constant && (flagAnnotation(property.type) || flagged) ? [property.name.getText(file)] : [];
  });
}

const settingsWhy = (flags: readonly string[]): string =>
  `holds ${String(flags.length)} required booleans (${flags.slice(0, 5).join(", ")}), none written in an update the checker traces to it: read once set, as settings are`;

/** Records past the default count none of whose flags is written in an update the checker traces to them. */
function settingsRecords(parsed: readonly (readonly [string, ts.SourceFile])[], checker: () => ts.TypeChecker): Proposal[] {
  const records: { node: ts.Node; name: string; flags: string[]; at: Evidence }[] = [];
  const updates: { member: ts.Node; object?: ts.ObjectLiteralExpression }[] = [];
  for (const [, file] of parsed) {
    for (const node of nodesUnder(file)) {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
        updates.push({ member: node.left.name });
      }
      const toSetter = (object: ts.ObjectLiteralExpression): boolean => ts.isCallExpression(object.parent) && setterState(calleeOf(object.parent)) !== null;
      if (ts.isObjectLiteralExpression(node) && (node.properties.some(ts.isSpreadAssignment) || toSetter(node))) {
        const written = node.properties.filter((one) => ts.isPropertyAssignment(one) || ts.isShorthandPropertyAssignment(one));
        updates.push(...written.map((one) => ({ member: one.name as ts.Node, object: node })));
      }
      const named = ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node) ? node.name?.text : undefined;
      const flags = named === undefined ? [] : recordFlags(node, file);
      if (named !== undefined && flags.length > RECORD_FLAGS) {
        records.push({ node, name: named, flags, at: evidenceAt(file, node) });
      }
    }
  }
  // A write counts against the record that declares the member it lands in, as the checker reads
  // it; a write whose type the checker cannot trace (a package's type, an untyped object) counts
  // against none, so the proposal leans towards the person's judgement rather than away from it.
  const wanted = new Set(records.flatMap((one) => one.flags));
  const written = new Set<ts.Node>();
  for (const { member, object } of updates.filter((one) => wanted.has(one.member.getText()))) {
    const symbol = object === undefined ? checker().getSymbolAtLocation(member) : checker().getContextualType(object)?.getProperty(member.getText());
    for (const declaration of symbol?.declarations ?? []) {
      const holder = declaration.parent;
      written.add(ts.isTypeLiteralNode(holder) ? holder.parent : holder);
    }
  }
  const unwritten = records.filter((one) => !written.has(one.node));
  // A suffix three such records share (`*Options`) is proposed as one pattern in their place.
  const bySuffix = Map.groupBy(unwritten, (one) => /[A-Z][a-z\d]*$/u.exec(one.name)?.[0] ?? one.name);
  return [...bySuffix].flatMap(([suffix, same]): Proposal[] => {
    if (same.length >= 3 && suffix !== same[0]?.name) {
      const names = same.map((one) => one.name);
      const reason =
        `${String(same.length)} records named \`*${suffix}\` hold more than ${String(RECORD_FLAGS)} required booleans, ` +
        `none written in an update the checker traces to it (${names.slice(0, 4).join(", ")})`;
      const score = same.length * 3 + (SETTINGS_NAME.test(suffix) ? 3 : 0);
      return [{ target: "prefer-state-union.ignore", value: `*${suffix}`, why: reason, score, evidence: same.slice(0, 4).map((one) => one.at) }];
    }
    return same.map(({ name, flags, at }) => {
      const score = flags.length + (SETTINGS_NAME.test(name) ? 3 : 0);
      return { target: "prefer-state-union.ignore", value: name, why: settingsWhy(flags), score, evidence: [at] };
    });
  });
}

/** The folder and file a path names, through `join`, a template, `+` or a `const` of the file. */
function placeOf(path: ts.Expression, file: ts.SourceFile, bound: ReadonlyMap<string, ts.Expression>, depth = 0): { folder: string; file: string } | null {
  const bare = ts.isParenthesizedExpression(path) || ts.isAsExpression(path) || ts.isAwaitExpression(path) ? path.expression : path;
  const text = (node: ts.Node): string => node.getText(file).replaceAll(/\s+/gu, "");
  if (ts.isIdentifier(bare)) {
    const value = bound.get(bare.text);
    return value === undefined || depth > 0 ? null : placeOf(value, file, bound, depth + 1);
  }
  if (ts.isCallExpression(bare) && JOINS.has(calleeOf(bare) ?? "") && bare.arguments.length >= 2) {
    const last = bare.arguments.at(-1);
    return last === undefined ? null : { folder: bare.arguments.slice(0, -1).map(text).join(","), file: text(last) };
  }
  if (ts.isPropertyAccessExpression(bare)) {
    return { folder: text(bare.expression), file: bare.name.text };
  }
  const whole = text(bare);
  const cut = whole.lastIndexOf("/");
  return (ts.isTemplateExpression(bare) || ts.isBinaryExpression(bare)) && cut > 0 ? { folder: whole.slice(0, cut), file: whole.slice(cut + 1) } : null;
}

/** The path a call writes as JSON or reads back from JSON, or null for any other call. */
function jsonPath(call: ts.CallExpression): { path: ts.Expression; writes: boolean } | null {
  const name = calleeOf(call) ?? "";
  const [first] = call.arguments;
  if (first === undefined) {
    return null;
  }
  const stringified = call.arguments.some((one) => ts.isCallExpression(one) && one.expression.getText() === "JSON.stringify");
  if (JSON_WRITES.has(name) || (TEXT_WRITES.has(name) && stringified)) {
    return { path: first, writes: true };
  }
  if (JSON_READS.has(name)) {
    return { path: first, writes: false };
  }
  const inner = ts.isAwaitExpression(first) ? first.expression : first;
  if (name === "parse" && call.expression.getText() === "JSON.parse" && ts.isCallExpression(inner) && TEXT_READS.has(calleeOf(inner) ?? "")) {
    return inner.arguments[0] === undefined ? null : { path: inner.arguments[0], writes: false };
  }
  return null;
}

/** Folders holding a file written as JSON and read back, by the last word of the folder's path. */
function stateFolders(parsed: readonly (readonly [string, ts.SourceFile])[]): Proposal[] {
  const files = new Map<string, { word: string; writes: Evidence[]; reads: Evidence[] }>();
  for (const [, file] of parsed) {
    const bound = new Map<string, ts.Expression>();
    for (const node of nodesUnder(file)) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        bound.set(node.name.text, node.initializer);
      }
      const json = ts.isCallExpression(node) ? jsonPath(node) : null;
      const place = json === null ? null : placeOf(json.path, file, bound);
      const word = place?.folder.match(/[$\w]+/gu)?.at(-1);
      if (json === null || place === null || word === undefined || word.length < 3 || GENERIC_FOLDER.has(word)) {
        continue;
      }
      const named = place.file.replaceAll(/["'`]/gu, "");
      if (MANIFESTS.has(named)) {
        continue;
      }
      const key = `${word} ${named}`;
      const entry = files.get(key) ?? { word, writes: [], reads: [] };
      (json.writes ? entry.writes : entry.reads).push(evidenceAt(file, node));
      files.set(key, entry);
    }
  }
  const both = [...files].filter(([, entry]) => entry.writes.length > 0 && entry.reads.length > 0);
  return [...Map.groupBy(both, ([, entry]) => entry.word)].map(([word, under]): Proposal => {
    const names = under.map(([key]) => key.slice(word.length + 1));
    const why = `holds ${String(names.length)} file${names.length === 1 ? "" : "s"} written as JSON and read back (${names.slice(0, 4).join(", ")})`;
    const evidence = under.flatMap(([, entry]) => [entry.writes[0], entry.reads[0]]).filter((one) => one !== undefined).slice(0, 4);
    return { target: "no-marker-file-state.stateDirs", value: word, why, score: names.length * 3, evidence };
  });
}

/** Exported literal sets the checker reads as written in an update, grouped by hand elsewhere. */
function stateTypes(
  parsed: readonly (readonly [string, ts.SourceFile])[],
  declared: readonly Declared[],
  groupings: readonly Grouping[],
  checker: () => ts.TypeChecker,
): Proposal[] {
  const readersOf = declared.map((set) =>
    groupings.filter((one) => one.path !== set.path && one.values.every((value) => set.values.has(value))),
  );
  const writes = stateWrites(new Map(parsed), declared.map((set, at) => ({ values: set.values, subjects: (readersOf[at] ?? []).map((one) => one.subject) })), checker);
  const proposed = declared.flatMap((set, at): (Proposal & { values: string })[] => {
    const readers = readersOf[at] ?? [];
    const write = writes[at];
    const named = STATE_NAME.test(set.name.split(".").at(-1) ?? set.name);
    if (readers.length === 0 || (write === undefined && !named)) {
      return [];
    }
    const writeAt = write === undefined ? null : evidenceAt(write.at.getSourceFile(), write.at);
    const grouped = `grouped by hand in ${places(readers.length)}`;
    const why =
      writeAt === null
        ? `${quoted(set.values)} is named like a state, but the checker reads no write of it; ${grouped}`
        : `${quoted(set.values)} is written in an update at ${writeAt.path}:${String(writeAt.line)}; ${grouped}`;
    const read = readers.slice(0, 2).map((one) => ({ path: one.path, line: one.line, text: one.subject }));
    const evidence = [{ path: set.path, line: set.line, text: set.name }, ...(writeAt === null ? [] : [writeAt]), ...read];
    const score = (writeAt === null ? 0 : 4) + (named ? 2 : 0) + Math.min(readers.length, 10) / 10;
    return [{ target: "scan.stateTypes", value: set.name, why, score, evidence, values: quoted([...set.values].toSorted()) }];
  });
  // One proposal a set of literals: an options record often restates one field's type many times.
  return [...Map.groupBy(proposed, (one) => one.values).values()].map((same) => {
    const [best, ...rest] = same.toSorted((a, b) => b.score - a.score);
    const { values: _values, ...proposal } = best ?? same[0]!;
    return rest.length === 0 ? proposal : { ...proposal, why: `${proposal.why}; ${places(rest.length, "other declaration")} spell the same literals` };
  });
}

/** A count with its noun, plural where it is not one. */
const places = (count: number, noun = "place"): string => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/** What makes two groupings the same: the field's last word and the literals, in order. */
const groupingKey = (one: Grouping): string => `${lastWord(one.subject)} ${quoted(one.values.toSorted())}`;

/** Exported functions typed as returning a boolean or a literal union that group a parameter's field
 *  spelled again by hand elsewhere; an owner whose groupings are spelled nowhere else changes nothing. */
function owners(functions: readonly Fn[], groupings: readonly Grouping[], checker: () => ts.TypeChecker): Proposal[] {
  const elsewhere = Map.groupBy(groupings, groupingKey);
  return functions.flatMap((fn): Proposal[] => {
    if (!fn.exported || fn.node.parameters.length === 0) {
      return [];
    }
    const parameters = new Set(fn.node.parameters.map((one) => one.name.getText(fn.file)));
    const own = groupings.filter((one) => one.within === fn.name && one.path === pathOf(fn.file) && parameters.has(/^[$\w]+/u.exec(one.subject)?.[0] ?? ""));
    if (own.length === 0) {
      return [];
    }
    const signature = checker().getSignatureFromDeclaration(fn.node);
    const returned = signature === undefined ? undefined : checker().getReturnTypeOfSignature(signature);
    const parts = returned === undefined ? [] : returned.isUnion() ? returned.types : [returned];
    const typed = parts.length > 0 && parts.every((one) => (one.flags & (ts.TypeFlags.BooleanLike | ts.TypeFlags.StringLiteral)) !== 0);
    if (!typed) {
      return [];
    }
    const copies = own.flatMap((one) => (elsewhere.get(groupingKey(one)) ?? []).filter((copy) => copy.within !== fn.name));
    if (copies.length === 0) {
      return [];
    }
    const returns = parts.some((one) => one.isStringLiteral()) ? "a literal union" : "a boolean";
    const groups = own.map((one) => `${quoted(one.values)} over \`${lastWord(one.subject)}\``).join("; ");
    const why = `typed as returning ${returns}, and groups ${groups}; spelled again by hand in ${places(copies.length)}`;
    const evidence = [evidenceAt(fn.file, fn.node), ...copies.slice(0, 3).map((one) => ({ path: one.path, line: one.line, text: one.subject }))];
    return [{ target: "scan.owners", value: fn.name, why, score: copies.length * 2 + own.length, evidence }];
  });
}

/** Every fact the survey proposes over a tree's files, best first within each target, and the facts it notes. */
export function survey(files: ReadonlyMap<string, string>): { proposals: Proposal[]; noted: Noted[] } {
  const parsed = [...parsedSources(files)].filter(([path]) => !isTestPath(path));
  const functions = functionsOf(parsed);
  const groupings = parsed.flatMap(([path, file]) => groupingsIn(path, file));
  let built: ts.TypeChecker | undefined;
  const checker = (): ts.TypeChecker => {
    built ??= checkerOver(new Map(parsed));
    return built;
  };
  const wrapping = wrappers(functions, callSites(parsed));
  const proposals = [
    ...wrapping.proposals,
    ...setters(parsed),
    ...settingsRecords(parsed, checker),
    ...stateFolders(parsed),
    ...stateTypes(parsed, declaredSets(parsed), groupings, checker),
    ...owners(functions, groupings, checker),
  ];
  const order = (one: Proposal): number => TARGETS.indexOf(one.target);
  return { proposals: proposals.toSorted((a, b) => order(a) - order(b) || b.score - a.score || a.value.localeCompare(b.value)), noted: wrapping.noted };
}
