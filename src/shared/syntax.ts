import type { ESTree } from "@oxlint/plugins";
import { isString } from "./values.ts";

/**
 * The syntax every rule reads: what a file is for, what a call or member is named, where a value
 * ends up, and the statement lists of a file. Nothing here names a module of any one repository,
 * so a rule built on it runs on any TypeScript tree.
 */

/** A file the test runner owns: a fixture states its states beside each other on purpose. */
const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|__mocks__|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/** Nodes that pass a value through unchanged, so a read inside one is a read of what it wraps. */
const TRANSPARENT = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "ChainExpression",
  "AwaitExpression",
]);

/** Statements and expressions whose `test` decides which way they go. */
const TESTS = new Set(["IfStatement", "WhileStatement", "DoWhileStatement", "ConditionalExpression", "ForStatement"]);

/** Operators that compute a value from their operands rather than compare them. */
const ARITHMETIC = new Set(["+", "-", "*"]);

/** A setter's name: `setStatus`, `setState`, `setAppState`. */
const SETTER = /^set([A-Z]\w*)$/u;

/** What a literal node holds: a string, number, boolean, bigint, regular expression or null. */
type LiteralValue = Extract<ESTree.Node, { type: "Literal" }>["value"];

/** The visitor a statement-list rule returns, so its scan sees each list once. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- a type alias stays assignable to the plugin's visitor, whose index signature an interface does not meet
type StatementLists = {
  Program: (node: ESTree.Program) => void;
  BlockStatement: (node: ESTree.BlockStatement) => void;
  SwitchCase: (node: ESTree.SwitchCase) => void;
};

/** The state a setter's name sets (`status` for `setStatus`, `appState` for `setAppState`), or
 *  null for any other name. */
export function setterState(name: string | null): string | null {
  const word = SETTER.exec(name ?? "")?.[1];
  return word === undefined ? null : `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
}

/** Whether the file belongs to a test suite rather than to the product. */
export function isTestPath(filename: string): boolean {
  return TEST_PATH.test(filename.replaceAll("\\", "/"));
}

/** The name an identifier spells, or null for any other node and for none. */
export function identifierName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "Identifier" ? node.name : null;
}

/** The property a static member read names (`a.b` as `b`), or null for a computed or private one. */
export function propertyName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "MemberExpression" && !node.computed ? identifierName(node.property) : null;
}

/** The object of a member read (`a` in `a.b` and `a[b]`), or null for any other node. */
export function memberObject(node: ESTree.Node | null | undefined): ESTree.Node | null {
  return node?.type === "MemberExpression" ? node.object : null;
}

/**
 * The value a literal holds, or undefined for any other node and for none. A regular expression
 * the runtime cannot build holds null too, so a test for the `null` literal reads `raw` instead.
 */
export function literalValue(node: ESTree.Node | null | undefined): LiteralValue | undefined {
  return node?.type === "Literal" ? node.value : undefined;
}

/** The plain `=` assignment a statement holds (`a = b;`, `a.b = c;`), or null for any other
 *  statement, a compound operator among them. */
export function plainAssignment(statement: ESTree.Node | null | undefined): ESTree.AssignmentExpression | null {
  const expression = statement?.type === "ExpressionStatement" ? statement.expression : null;
  return expression?.type === "AssignmentExpression" && expression.operator === "=" ? expression : null;
}

/** The declaration a statement carries, past `export`. */
export function declaredBy(statement: ESTree.Node): ESTree.Node {
  const exported = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
  if (!exported) return statement;
  return statement.declaration ?? statement;
}

/**
 * Every statement list in the file, for a rule that reads a statement against the ones around it.
 * Three node types hold one: a module body, a block and a `switch` case.
 */
export function everyStatementList(scan: (body: readonly ESTree.Statement[]) => void): StatementLists {
  return {
    Program: (node) => scan(node.body),
    BlockStatement: (node) => scan(node.body),
    SwitchCase: (node) => scan(node.consequent),
  };
}

/** `existsSync` for `existsSync(p)`, `fs.existsSync(p)` and `fs["existsSync"](p)`; null otherwise. */
export function calleeName(call: ESTree.CallExpression | ESTree.NewExpression): string | null {
  const callee = call.callee;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (callee.type !== "MemberExpression") {
    return null;
  }
  const key = propertyName(callee) ?? literalValue(callee.property);
  return isString(key) ? key : null;
}

/** The node with every transparent wrapper above it climbed, so its parent is the first reader. */
export function outermost(node: ESTree.Node): ESTree.Node {
  let at = node;
  while (at.parent !== null && at.parent !== undefined && TRANSPARENT.has(at.parent.type)) {
    at = at.parent;
  }
  return at;
}

/** The node with every transparent wrapper inside it removed. */
export function innermost(node: ESTree.Node): ESTree.Node {
  if (node.type === "AwaitExpression") {
    return innermost(node.argument);
  }
  const wraps =
    node.type === "ParenthesizedExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "ChainExpression";
  return wraps ? innermost(node.expression) : node;
}

/** The nearest function around a node, or null at module scope. */
export function enclosingFunction(node: ESTree.Node): ESTree.Function | ESTree.ArrowFunctionExpression | null {
  for (let at = node.parent; at !== null && at !== undefined; at = at.parent) {
    if (at.type === "ArrowFunctionExpression" || at.type === "FunctionDeclaration" || at.type === "FunctionExpression") {
      return at;
    }
  }
  return null;
}

/**
 * Whether the value of `node` decides something: it is (or is negated, combined or compared into)
 * the test of an `if`, a loop or a ternary, an operand of a comparison, or what a function returns.
 */
export function decides(node: ESTree.Node): boolean {
  let at = outermost(node);
  for (let parent = at.parent; parent !== null && parent !== undefined; parent = at.parent) {
    if (parent.type !== "UnaryExpression" && parent.type !== "LogicalExpression") {
      return decidedBy(parent, at);
    }
    at = outermost(parent);
  }
  return false;
}

/** Whether `parent` decides on its child `at`: as a test, a comparison, a return or an arrow's value. */
function decidedBy(parent: ESTree.Node, at: ESTree.Node): boolean {
  if (TESTS.has(parent.type)) {
    return "test" in parent && parent.test === at;
  }
  if (parent.type === "BinaryExpression") {
    return !ARITHMETIC.has(parent.operator);
  }
  if (parent.type === "ArrowFunctionExpression") {
    return parent.body === at;
  }
  return parent.type === "ReturnStatement";
}
