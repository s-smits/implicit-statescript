/**
 * `state-literal-spread`: a declared set of states compared by hand in several files. An Oxlint
 * rule sees one file, so it cannot tell a union's owner from its readers; this scan reads every
 * file at once.
 *
 * The scan infers each declared set of states from the syntax: a type alias or an inline union of
 * two or more string literals, an `as const` array or object of string literals, a string `enum`,
 * a `Set` of string literals, and the discriminant of a union of object types. Only an exported
 * set counts, and the file declaring it owns it. A reader groups states when one condition
 * compares one subject with two or more of them (`s === "done" || s === "failed"`,
 * `s !== "a" && s !== "b"`, `["done", "failed"].includes(s)`, `new Set([...]).has(s)`, or `case`
 * labels falling through to one body in a switch that is not exhaustive). A grouping written
 * outside the owner names a derived state ("ended") that only the reader knows, so each reader
 * re-derives it and their sets drift. Reported: a declared set grouped by hand in `readers` or more
 * files besides its owner (2 by default), at the owner, with every grouping as a place. A grouping
 * maps to the smallest declared set holding all its literals; an exhaustive switch maps every state
 * and does not count. The remedy is a predicate or a table in the owner that each reader calls.
 *
 * A set none of whose literals is written where a value changes reads as an enumeration of kinds
 * rather than a state (`state-role.ts`) and is reported apart, as `enumeration-literal-spread`.
 *
 * Not read: tests, declaration files, vendored and generated folders. `typeof x === "string"` is
 * no state. The scan is syntactic apart from that filter, and leans to silence.
 */
import * as ts from "typescript5";
import { isTestPath } from "../shared/syntax.ts";
import { type LiteralSet, statefulSets } from "./state-role.ts";

/** What the scan reports: a state, or a set read as an enumeration of kinds. */
export type FindingKind = "state-literal-spread" | "enumeration-literal-spread";

/** One finding: where the set is declared, why, and every place that groups it. */
export interface Finding {
  kind: FindingKind;
  path: string;
  line: number;
  detail: string;
  places: readonly { path: string; line: number }[];
}

/** A declared set of states and the file that owns it. */
interface Declared {
  name: string;
  values: ReadonlySet<string>;
  path: string;
  line: number;
  /** For a discriminated union, the property its states sit in: a reader compares that property. */
  property?: string;
}

/** A union of object types, resolved once every file's tagged properties are known. */
interface Variants {
  name: string;
  members: readonly ts.TypeNode[];
  path: string;
  line: number;
}

/** One condition that compares one subject with two or more literals. */
interface Grouping {
  subject: string;
  values: readonly string[];
  path: string;
  line: number;
  /** For a switch, every literal its cases name, to tell an exhaustive one. */
  switchCovers?: ReadonlySet<string>;
}

/** What the declarations of every file add up to before any reader is read. */
interface Tally {
  /** Each named object type's properties typed by one string literal (`kind: "pass"`). */
  tagged: Map<string, ReadonlyMap<string, string>>;
  variants: Variants[];
}

/** How many files besides the owner must group a set by hand before it is reported. */
export const READER_FLOOR = 2;
/** The name of a union typing a return value or an argument: a signature, which owns no states. */
const INLINE = "(inline)";

const lineOf = (file: ts.SourceFile, node: ts.Node): number => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
const textOf = (file: ts.SourceFile, node: ts.Node): string => node.getText(file).replaceAll(/\s+/gu, "");

/** Each file parsed once, declaration files left out. */
function parsedSources(files: ReadonlyMap<string, string>): Map<string, ts.SourceFile> {
  return new Map(
    [...files]
      .filter(([path]) => !/\.d\.[cm]?ts$/u.test(path))
      .map(([path, text]) => [
        path,
        ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
      ]),
  );
}

/** The properties of an object type that a single string literal types. */
function tagsOf(members: readonly ts.TypeElement[]): Map<string, string> {
  const tags = new Map<string, string>();
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) {
      continue;
    }
    const { type } = member;
    if (type !== undefined && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
      tags.set(member.name.text, type.literal.text);
    }
  }
  return tags;
}

/**
 * Whether the top-level statement holding a node is exported, by its modifier or by name in an
 * `export { }` list. Only an exported set can own states another file reads; a file's private
 * table of the platform's own names (`new Set(["ArrowFunctionExpression", ...])`) owns nothing.
 */
function exported(node: ts.Node, file: ts.SourceFile): boolean {
  let top = node;
  while (top.parent !== undefined && !ts.isSourceFile(top.parent)) {
    if (ts.isFunctionLike(top) || ts.isBlock(top)) {
      return false;
    }
    top = top.parent;
  }
  const modifiers = ts.canHaveModifiers(top) ? (ts.getModifiers(top) ?? []) : [];
  if (modifiers.some((one) => one.kind === ts.SyntaxKind.ExportKeyword)) {
    return true;
  }
  const names = ts.isVariableStatement(top)
    ? top.declarationList.declarations.map((one) => one.name.getText(file))
    : [ts.isTypeAliasDeclaration(top) || ts.isInterfaceDeclaration(top) || ts.isEnumDeclaration(top) ? top.name.text : ""];
  return file.statements.some(
    (one) =>
      ts.isExportDeclaration(one) &&
      one.moduleSpecifier === undefined &&
      one.exportClause !== undefined &&
      ts.isNamedExports(one.exportClause) &&
      one.exportClause.elements.some((element) => names.includes((element.propertyName ?? element.name).text)),
  );
}

/** Records a named object type's tags, and a union of object types to resolve later. */
function noteTags(node: ts.Node, tally: Tally, path: string, file: ts.SourceFile): void {
  if (ts.isInterfaceDeclaration(node)) {
    tally.tagged.set(node.name.text, tagsOf(node.members));
  }
  if (!ts.isTypeAliasDeclaration(node)) {
    return;
  }
  const { type } = node;
  if (ts.isTypeLiteralNode(type)) {
    tally.tagged.set(node.name.text, tagsOf(type.members));
  }
  const objects = ts.isUnionTypeNode(type) && type.types.every((one) => ts.isTypeLiteralNode(one) || ts.isTypeReferenceNode(one));
  if (objects && exported(node, file)) {
    tally.variants.push({ name: node.name.text, members: type.types, path, line: lineOf(file, node) });
  }
}

/** The states of a discriminated union: a property every member types by its own literal. */
function discriminated(variants: Variants, tagged: Tally["tagged"]): Declared[] {
  const resolved = variants.members.map((one) =>
    ts.isTypeLiteralNode(one) ? tagsOf(one.members) : tagged.get(ts.isTypeReferenceNode(one) ? one.typeName.getText() : ""),
  );
  const [first, ...rest] = resolved;
  if (first === undefined || resolved.includes(undefined)) {
    return [];
  }
  return [...first.keys()].flatMap((property) => {
    const values = new Set(resolved.map((tags) => tags?.get(property)));
    if (values.has(undefined) || values.size < 2 || rest.length === 0) {
      return [];
    }
    const states = new Set([...values].filter((value) => value !== undefined));
    return [{ name: `${variants.name}.${property}`, values: states, path: variants.path, line: variants.line, property }];
  });
}

/** The string literals of a union type, or null where a member is anything else but `null` or
 *  `undefined`. */
function unionValues(node: ts.TypeNode): string[] | null {
  if (!ts.isUnionTypeNode(node)) {
    return null;
  }
  const values: string[] = [];
  for (const member of node.types) {
    const empty = ts.isLiteralTypeNode(member)
      ? member.literal.kind === ts.SyntaxKind.NullKeyword
      : member.kind === ts.SyntaxKind.UndefinedKeyword;
    if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
      values.push(member.literal.text);
    } else if (!empty) {
      return null;
    }
  }
  return values;
}

/** The string literals an `as const` array or object, a `Set` of literals or a string enum holds. */
function constValues(node: ts.Node): string[] | null {
  let inner = node;
  const asConst = ts.isAsExpression(inner) && inner.type.getText() === "const";
  if (ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) {
    inner = inner.expression;
  }
  if (ts.isNewExpression(inner) && inner.expression.getText() === "Set") {
    const [items] = inner.arguments ?? [];
    return items !== undefined && ts.isArrayLiteralExpression(items) ? literalsOf(items.elements) : null;
  }
  if (!asConst) {
    return null;
  }
  if (ts.isArrayLiteralExpression(inner)) {
    return literalsOf(inner.elements);
  }
  if (!ts.isObjectLiteralExpression(inner)) {
    return null;
  }
  return literalsOf(inner.properties.flatMap((one) => (ts.isPropertyAssignment(one) ? [one.initializer] : [])));
}

/** Every element's text where all are string literals, else null. */
function literalsOf(nodes: readonly ts.Node[]): string[] | null {
  const values = nodes.flatMap((one) => (ts.isStringLiteralLike(one) ? [one.text] : []));
  return values.length === nodes.length ? values : null;
}

/** The name a union is declared under: its alias, or the property, parameter or variable it types. */
function nameOf(node: ts.Node, file: ts.SourceFile): string {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isTypeAliasDeclaration(at) || ts.isEnumDeclaration(at)) && ts.isIdentifier(at.name)) {
      return at.name.text;
    }
    if (ts.isParameter(at) || ts.isFunctionLike(at)) {
      return INLINE;
    }
    if (ts.isPropertySignature(at) || ts.isPropertyDeclaration(at) || ts.isVariableDeclaration(at)) {
      const owner = at.parent;
      const prefix = ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner) ? `${owner.name?.text ?? ""}.` : "";
      return `${prefix}${at.name.getText(file)}`;
    }
  }
  return INLINE;
}

/** Every declared set of states in one file. */
function declaredIn(path: string, file: ts.SourceFile, tally: Tally): Declared[] {
  const found: Declared[] = [];
  const add = (node: ts.Node, values: readonly string[] | null): void => {
    const name = nameOf(node, file);
    if (values !== null && new Set(values).size >= 2 && name !== INLINE && exported(node, file)) {
      found.push({ name, values: new Set(values), path, line: lineOf(file, node) });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isUnionTypeNode(node) && !ts.isUnionTypeNode(node.parent)) {
      add(node, unionValues(node));
    }
    noteTags(node, tally, path, file);
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      add(node.initializer, constValues(node.initializer));
    }
    if (ts.isEnumDeclaration(node)) {
      add(node.members[0] ?? node, literalsOf(node.members.flatMap((one) => (one.initializer === undefined ? [] : [one.initializer]))));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The subject and literal of `subject === "literal"` (either way round), or null. */
function compared(node: ts.Expression, file: ts.SourceFile, equal: boolean): [string, string] | null {
  if (!ts.isBinaryExpression(node)) {
    return null;
  }
  const kind = node.operatorToken.kind;
  const operators = equal
    ? [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken]
    : [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken];
  if (!operators.includes(kind)) {
    return null;
  }
  const [subject, literal] = ts.isStringLiteralLike(node.right) ? [node.left, node.right] : [node.right, node.left];
  if (!ts.isStringLiteralLike(literal) || ts.isTypeOfExpression(subject) || ts.isStringLiteralLike(subject)) {
    return null;
  }
  return [textOf(file, subject), literal.text];
}

/** The operands of a chain of one logical operator, flattened through parentheses. */
function chain(node: ts.Expression, operator: ts.SyntaxKind): ts.Expression[] {
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === operator) {
    return [...chain(inner.left, operator), ...chain(inner.right, operator)];
  }
  return [inner];
}

/** The groupings a logical chain makes: per subject, the literals it is compared with. */
function chainGroupings(node: ts.BinaryExpression, file: ts.SourceFile, path: string): Grouping[] {
  const operator = node.operatorToken.kind;
  const equal = operator === ts.SyntaxKind.BarBarToken;
  if (!equal && operator !== ts.SyntaxKind.AmpersandAmpersandToken) {
    return [];
  }
  const parent = ts.isParenthesizedExpression(node.parent) ? node.parent.parent : node.parent;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === operator) {
    return [];
  }
  const pairs = chain(node, operator).flatMap((one) => [compared(one, file, equal)].filter((pair) => pair !== null));
  return [...Map.groupBy(pairs, ([subject]) => subject)].flatMap(([subject, under]) => {
    const values = [...new Set(under.map(([, value]) => value))];
    return values.length < 2 ? [] : [{ subject, values, path, line: lineOf(file, node) }];
  });
}

/** `[...].includes(x)` and `new Set([...]).has(x)` over two or more string literals. */
function membershipGrouping(node: ts.CallExpression, file: ts.SourceFile, path: string): Grouping | null {
  const callee = node.expression;
  const [subject] = node.arguments;
  if (!ts.isPropertyAccessExpression(callee) || subject === undefined) {
    return null;
  }
  const method = callee.name.text;
  const list = method === "includes" && ts.isArrayLiteralExpression(callee.expression) ? callee.expression : null;
  const set = method === "has" ? constValues(callee.expression) : null;
  const values = list === null ? set : literalsOf(list.elements);
  return values === null || values.length < 2 ? null : { subject: textOf(file, subject), values, path, line: lineOf(file, node) };
}

/** Case labels that fall through to one body, in a switch over a subject. */
function switchGroupings(node: ts.SwitchStatement, file: ts.SourceFile, path: string): Grouping[] {
  const covers = new Set<string>();
  const groups: string[][] = [[]];
  for (const clause of node.caseBlock.clauses) {
    if (ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression)) {
      covers.add(clause.expression.text);
      groups.at(-1)?.push(clause.expression.text);
    }
    if (clause.statements.length > 0) {
      groups.push([]);
    }
  }
  const subject = textOf(file, node.expression);
  return groups
    .filter((values) => values.length >= 2)
    .map((values) => ({ subject, values, path, line: lineOf(file, node), switchCovers: covers }));
}

function groupingsIn(path: string, file: ts.SourceFile): Grouping[] {
  const found: Grouping[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      found.push(...chainGroupings(node, file, path));
    }
    const membership = ts.isCallExpression(node) ? membershipGrouping(node, file, path) : null;
    if (membership !== null) {
      found.push(membership);
    }
    if (ts.isSwitchStatement(node)) {
      found.push(...switchGroupings(node, file, path));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const quoted = (values: Iterable<string>): string => [...values].map((value) => `"${value}"`).join(" | ");

/** Every declared set of states grouped by hand in `readers` or more other files. */
export function literalSpread(files: ReadonlyMap<string, string>, readers = READER_FLOOR): Finding[] {
  const parsed = [...parsedSources(files)].filter(([path]) => !isTestPath(path));
  const tally: Tally = { tagged: new Map(), variants: [] };
  const declared = parsed.flatMap(([path, file]) => declaredIn(path, file, tally));
  declared.push(...tally.variants.flatMap((one) => discriminated(one, tally.tagged)));
  const groupings = parsed.flatMap(([path, file]) => groupingsIn(path, file));
  const owned = new Map<Declared, Grouping[]>();
  for (const grouping of groupings) {
    // The smallest declared set outside the grouping's file that holds every literal of it, one
    // whose states sit in a property the grouping compares first.
    const owner = declared
      .filter((one) => one.path !== grouping.path && grouping.values.every((value) => one.values.has(value)))
      .filter(({ property }) => property === undefined || grouping.subject === property || grouping.subject.endsWith(`.${property}`))
      .toSorted((a, b) => Number(b.property !== undefined) - Number(a.property !== undefined) || a.values.size - b.values.size)[0];
    // A switch that names every state maps them all. A chain or a list that spells a whole set is
    // the grouping that set already names (`isLinear` beside `"arrow" | "line"`), so it counts.
    const covers = grouping.switchCovers;
    const exhaustive = owner !== undefined && covers !== undefined && [...owner.values].every((value) => covers.has(value));
    if (owner !== undefined && !exhaustive) {
      owned.set(owner, [...(owned.get(owner) ?? []), grouping]);
    }
  }
  const found: { row: Finding; set: LiteralSet }[] = [];
  for (const [owner, groupedBy] of owned) {
    const readerFiles = new Set(groupedBy.map((one) => one.path));
    if (readerFiles.size < readers) {
      continue;
    }
    const sets = new Set(groupedBy.map((one) => quoted(one.values.toSorted())));
    const row: Finding = {
      kind: "state-literal-spread",
      path: owner.path,
      line: owner.line,
      detail: `\`${owner.name}\` (${quoted(owner.values)}) is grouped by hand in ${readerFiles.size} other files, as ${[...sets].join("; ")}: give each grouping a name in the owner and call it`,
      places: [owner, ...groupedBy].map((one) => ({ path: one.path, line: one.line })),
    };
    found.push({ row, set: { values: owner.values, subjects: groupedBy.map((one) => one.subject) } });
  }
  const stateful = statefulSets(
    new Map(parsed),
    found.map((one) => one.set),
  );
  return found.map(({ row }, index) =>
    stateful[index] === true
      ? row
      : {
          ...row,
          kind: "enumeration-literal-spread",
          detail: `an enumeration rather than a state, since no literal of it is written where a value changes: ${row.detail}`,
        },
  );
}
