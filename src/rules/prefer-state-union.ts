import { defineRule, type ESTree } from "@oxlint/plugins";
import { flagBinding, isFlagType } from "../shared/flags.ts";
import {
  calleeName,
  enclosingFunction,
  identifierName,
  innermost,
  isTestPath,
  literalValue,
  objectValues,
  outermost,
  propertyName,
} from "../shared/syntax.ts";
import {
  asRecord,
  isBoolean,
  isNumber,
  type JsonValue,
  NAMES_SCHEMA,
  nameMatcher,
  type RuleExample,
} from "../shared/values.ts";

/**
 * Booleans that are one state spelled as flags: `isPending`, `isProcessing` and `isFinished` admit
 * eight combinations of which three mean anything, and every reader has to know which five never
 * happen. One union, or a discriminated union where each state carries its own data, makes the
 * impossible combinations unspellable.
 *
 * This rule belongs to the opinionated tier: on foreign code its shapes were right in about half of
 * the labelled hits, below what a generic rule must reach, since a large class keeps unrelated
 * latches (a warn-once flag, a lazy load, a restore guard) that the syntax cannot tell from a
 * lifecycle, and most records of flags elsewhere hold independent options.
 *
 * Two shapes are read from what the code does with the flags:
 *
 * - A class whose methods move two or more of its boolean fields at different times: `started`
 *   set in `start()` and `closed` in `close()` are a lifecycle (created, started, closed) held as
 *   flags, and every reader has to know that closed without started never happens. A method moves
 *   a field when it, the constructor aside, assigns `this.<field>`. Flags the same methods always
 *   move together (modifier keys a key handler reads off one event) and fields only the
 *   constructor sets (configuration) are left alone. Reported at the class body.
 * - An object holding a flag derived from two of its own other fields:
 *   `{ either: h || v, horizontal: h, vertical: v }`, directly or through a `const`. The three admit
 *   eight combinations where four happen. The fields must be flags: the declared return type says
 *   so, or the two sources are comparisons, negations or boolean literals, so a default (`title ||
 *   name`) stays silent. Reported at the declared return type where there is one, and at the object
 *   otherwise.
 *
 * The count is ported from Clippy's `struct_excessive_bools` and `fn_params_excessive_bools`
 * (rust-lang/rust-clippy, `clippy_lints/src/excessive_bools.rs`, at 146674fd), which began as
 * Armin Ronacher's `rust-excessive-bools-lint` (at 0f95d162); `THIRD_PARTY_NOTICES.md` records both.
 * Read as Clippy reads a struct: an interface, an object type literal or a class with more than
 * `max` boolean members (Clippy's default, 3) is reported, unless the class is already reported as
 * a lifecycle. A member counts when it is required and its annotation is `boolean`, or `true` or
 * `false`, with `undefined` or `null` allowed beside them, or, on a class, when it has a `true` or
 * `false` initialiser. An optional member does not count: a record of optional flags is a set of
 * settings a caller may leave out one by one (a build's `minify?`, `sourcemap?`). A member typed as
 * one literal (`procedure: true`, `declare isNamespace: true`) is a brand or a discriminant, and a
 * `readonly` field given a literal (`readonly isCluster = false`) is a constant, so neither counts;
 * a `readonly` field the constructor computes still does. The TypeScript port adds the one record
 * Rust does not have: the boolean `useState` cells of one function, which in a React component are
 * that component's state record. A cell is a call named `useState` (`useState(false)`,
 * `React.useState<boolean>()`), as React and Preact spell it, whose initial value is a boolean
 * literal or whose type argument is a flag. `max: null` turns the record count off and leaves the
 * two shapes.
 *
 * The function half counts a declaration's boolean parameters and reports more than `params`
 * (Clippy's default, 3). A repository that already reports every boolean parameter on its own
 * passes `params: null` and keeps one owner for that fact.
 *
 * `ignore` names the records, classes, components and functions a repository reads as settings
 * rather than state (`TldrawOptions`, or `*Props` for every props record), by name with `*` for
 * any run of characters. It applies to every shape: a class by its name, a derived flag by the
 * function that builds its object. It is a fact about one repository, so it is empty by default.
 *
 * Test files and declaration files (`.d.ts`, another package's interface described) are not read:
 * a fixture lists its flags beside each other on purpose.
 *
 * There is no fix: which states the flags stand for is the whole change.
 */
const MAX_FIELDS = 3;
const MAX_PARAMS = 3;
const DECLARATION = /\.d\.[cm]?ts$/u;
const COMPARISON = new Set(["===", "!==", "==", "!=", "<", "<=", ">", ">=", "in", "instanceof"]);

type FunctionLike = ESTree.Function | ESTree.ArrowFunctionExpression | ESTree.TSMethodSignature;
type Member = ESTree.MethodDefinition | ESTree.PropertyDefinition;

/** The name a member declares, for the message: an identifier's, or a string key's text. */
function memberName(key: ESTree.Node): string {
  const literal = literalValue(key);
  return identifierName(key) ?? (typeof literal === "string" ? `'${literal}'` : "member");
}

/** Whether an annotation is a flag that can change: a brand or discriminant (`ready: true`) is not. */
const changingFlag = (type: ESTree.TSType | undefined): boolean =>
  type?.type !== "TSLiteralType" && isFlagType(type);

/** The boolean members of an interface or a type literal, by name. */
function booleanSignatures(members: readonly ESTree.TSSignature[]): string[] {
  return members.flatMap((member) =>
    member.type === "TSPropertySignature" &&
    !member.optional &&
    changingFlag(member.typeAnnotation?.typeAnnotation)
      ? [memberName(member.key)]
      : [],
  );
}

/** The boolean fields of a class body that can change: annotated as a flag, or initialised to a
 *  boolean literal and not `readonly`. */
function booleanFields(body: ESTree.ClassBody): string[] {
  return body.body.flatMap((member) => {
    if (member.type !== "PropertyDefinition" || member.static || member.optional === true) {
      return [];
    }
    const literal = isBoolean(literalValue(member.value));
    if (member.readonly === true && literal) {
      return [];
    }
    return changingFlag(member.typeAnnotation?.typeAnnotation) || literal ? [memberName(member.key)] : [];
  });
}

/** The class member a node sits in, or null at the top of a constructor or outside a class. */
function memberOf(node: ESTree.Node): Member | null {
  for (let at = node.parent; at !== null && at !== undefined; at = at.parent) {
    if (at.type === "MethodDefinition") {
      return at.kind === "constructor" ? null : at;
    }
    if (at.type === "PropertyDefinition" && at.parent?.type === "ClassBody") {
      return at;
    }
  }
  return null;
}

/** Whether a call is a `useState` cell holding a boolean: a boolean literal, or `<boolean>`. */
function booleanCell(call: ESTree.CallExpression): boolean {
  if (calleeName(call) !== "useState") {
    return false;
  }
  const [initial] = call.arguments;
  const typed = call.typeArguments?.params[0];
  return isBoolean(literalValue(initial)) || isFlagType(typed);
}

/** The name a `const [x, setX] = useState(…)` binds, or a placeholder. */
function cellName(call: ESTree.CallExpression): string {
  const declarator = call.parent;
  if (declarator?.type !== "VariableDeclarator" || declarator.id.type !== "ArrayPattern") {
    return "state";
  }
  const [first] = declarator.id.elements;
  return identifierName(first) ?? "state";
}

/** The name a function declares, for the message. */
const named = (node: { id?: ESTree.Node | null }): string => identifierName(node.id) ?? "this function";

/**
 * The name a record is declared under, for `ignore`: an interface's, a type alias's for its object
 * type, a class's for its body, and a function's for its `useState` cells, by its own name or the
 * `const` it is bound to. Null for an object type or a function nothing names.
 */
function declaredName(node: ESTree.Node | null): string | null {
  if (node === null) {
    return null;
  }
  if (node.type === "TSInterfaceDeclaration") {
    return node.id.name;
  }
  const holder = node.parent;
  if (node.type === "TSTypeLiteral" || node.type === "ClassBody") {
    return holder?.type === "TSTypeAliasDeclaration" || holder?.type === "ClassDeclaration" || holder?.type === "ClassExpression"
      ? identifierName(holder.id)
      : null;
  }
  const own = node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ? identifierName(node.id) : null;
  return own ?? (holder?.type === "VariableDeclarator" ? identifierName(holder.id) : null);
}

/** A threshold option: a number, or null to leave that half to another rule. */
function threshold(option: JsonValue | undefined, fallback: number): number | null {
  if (option === null) {
    return null;
  }
  return isNumber(option) ? option : fallback;
}

export const preferStateUnionRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Booleans that are one state spelled as flags admit combinations nobody means; name the states.",
      examples: [
        {
          before:
            "class Server {\n  started = false;\n  closed = false;\n  start() { this.started = true; }\n  close() { this.closed = true; }\n}",
          after:
            'class Server {\n  phase: "created" | "started" | "closed" = "created";\n  start() { this.phase = "started"; }\n  close() { this.phase = "closed"; }\n}',
        },
        {
          before:
            "export interface Job {\n  queued: boolean;\n  running: boolean;\n  done: boolean;\n  failed: boolean;\n}",
          after: 'export interface Job {\n  state: "queued" | "running" | "done" | "failed";\n}',
        },
      ] satisfies RuleExample[],
    },
    schema: [
      {
        type: "object",
        properties: {
          max: { type: ["number", "null"] },
          params: { type: ["number", "null"] },
          ignore: NAMES_SCHEMA,
        },
        additionalProperties: false,
      },
    ],
    messages: {
      lifecycle:
        "{{what}} holds {{count}} boolean fields its methods move at different times ({{names}}). Flags admit every combination; one field naming the phase admits only the ones that happen.",
      derived:
        "This record holds 3 booleans where `{{derived}}` is derived from `{{a}}` and `{{b}}`, so only some of their combinations happen. Hold the state once and derive the rest where it is read.",
      record:
        "{{what}} holds {{count}} booleans ({{names}}), more than {{max}}. Flags admit every combination; a union of named states admits only the ones that happen.",
      parameters:
        "`{{fn}}` takes {{count}} boolean parameters, more than {{max}}. Name the modes with string-literal unions, or split the operation.",
    },
  },
  create(context) {
    if (isTestPath(context.filename) || DECLARATION.test(context.filename)) {
      return {};
    }
    const option = asRecord(context.options[0]) ?? {};
    const max = threshold(option.max, MAX_FIELDS);
    const params = threshold(option.params, MAX_PARAMS);
    const ignored = nameMatcher(option.ignore);
    const cells = new Map<ESTree.Node, string[]>();
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node).replaceAll(/\s+/gu, "");
    const bound = new Map<string, ESTree.Node>();
    const objects: ESTree.ObjectExpression[] = [];
    /** For each class body, the methods that move each of its boolean fields. */
    const moves = new Map<ESTree.ClassBody, Map<string, Set<string>>>();
    /** The nodes already reported, so a record the count and a shape both read is reported once. */
    const reported = new Set<ESTree.Node>();
    const resolved = (node: ESTree.Node): ESTree.Node => {
      const value = innermost(node);
      return innermost(bound.get(identifierName(value) ?? "") ?? value);
    };
    const isFlagValue = (node: ESTree.Node): boolean => {
      const value = resolved(node);
      if (value.type === "BinaryExpression") {
        return COMPARISON.has(value.operator);
      }
      return (value.type === "UnaryExpression" && value.operator === "!") || isBoolean(literalValue(value));
    };

    /** The first field of an object derived by `||` or `&&` from two other flags of it. */
    function derivedField(object: ESTree.ObjectExpression, declared: ESTree.TSType | undefined): string[] | null {
      const sources = objectValues(object);
      const values = new Map([...sources].map(([name, value]) => [text(value), name]));
      const members = declared?.type === "TSTypeLiteral" ? declared.members : [];
      for (const [name, value] of sources) {
        const source = resolved(value);
        if (source.type !== "LogicalExpression" || source.operator === "??") {
          continue;
        }
        const a = values.get(text(source.left));
        const b = values.get(text(source.right));
        const typed = members.some(
          (member) =>
            member.type === "TSPropertySignature" &&
            identifierName(member.key) === name &&
            isFlagType(member.typeAnnotation?.typeAnnotation),
        );
        const flags = typed || (isFlagValue(source.left) && isFlagValue(source.right));
        const others = a !== undefined && b !== undefined && a !== b && a !== name && b !== name;
        if (others && flags) {
          return [name, a, b];
        }
      }
      return null;
    }

    /** Report a record past `max`, under its name where it has one (`` `Job` ``, `` `Form`'s
     *  `useState` record ``) and as `unnamed` where it has none. */
    function record(node: ESTree.Node, unnamed: string, names: readonly string[], suffix = ""): void {
      const name = declaredName(node);
      if (max === null || names.length <= max || (name !== null && ignored(name))) {
        return;
      }
      const what = name === null ? unnamed : `\`${name}\`${suffix}`;
      const data = { what, count: String(names.length), names: names.join(", "), max: String(max) };
      reported.add(node);
      context.report({ node, messageId: "record", data });
    }

    function parameters(node: FunctionLike, fn: string): void {
      if (params === null || ignored(fn)) {
        return;
      }
      const flags = node.params.filter((parameter) => flagBinding(parameter) !== null);
      if (flags.length <= params) {
        return;
      }
      context.report({
        node,
        messageId: "parameters",
        data: { fn, count: String(flags.length), max: String(params) },
      });
    }

    return {
      TSInterfaceDeclaration: (node) =>
        record(node, "this interface", booleanSignatures(node.body.body)),
      TSTypeLiteral: (node) => record(node, "this object type", booleanSignatures(node.members)),
      ClassBody: (node) => {
        moves.set(node, new Map(booleanFields(node).map((field) => [field, new Set<string>()])));
      },
      AssignmentExpression: (node) => {
        const field = propertyName(node.left);
        const member = memberOf(node);
        const body = member?.parent;
        const target = node.left.type === "MemberExpression" && node.left.object.type === "ThisExpression";
        if (!target || field === null || member === null || body?.type !== "ClassBody") {
          return;
        }
        moves.get(body)?.get(field)?.add(text(member.key));
      },
      "ClassBody:exit": (node) => {
        const fields = moves.get(node) ?? new Map<string, Set<string>>();
        const moved = [...fields].filter(([, by]) => by.size > 0);
        const times = new Set(moved.map(([, by]) => [...by].toSorted().join(" ")));
        const name = declaredName(node);
        if (moved.length < 2 || times.size < 2) {
          record(node, "this class", [...fields.keys()]);
          return;
        }
        if (name !== null && ignored(name)) {
          return;
        }
        const what = name === null ? "This class" : `\`${name}\``;
        const names = moved.map(([field]) => `\`${field}\``).join(", ");
        reported.add(node);
        context.report({ node, messageId: "lifecycle", data: { what, count: String(moved.length), names } });
      },
      VariableDeclarator: (node) => {
        if (node.id.type === "Identifier" && node.init !== null) {
          bound.set(node.id.name, node.init);
        }
      },
      ObjectExpression: (node) => {
        objects.push(node);
      },
      CallExpression: (node) => {
        if (!booleanCell(node)) {
          return;
        }
        let owner: ESTree.Node | null = node.parent;
        while (
          owner !== null &&
          owner.type !== "FunctionDeclaration" &&
          owner.type !== "ArrowFunctionExpression" &&
          owner.type !== "FunctionExpression"
        ) {
          owner = owner.parent;
        }
        if (owner !== null) {
          cells.set(owner, [...(cells.get(owner) ?? []), cellName(node)]);
        }
      },
      "Program:exit": () => {
        for (const [owner, names] of cells) {
          record(owner, "this function's `useState` record", names, "'s `useState` record");
        }
        for (const object of objects) {
          const at = outermost(object).parent;
          const returned = at?.type === "ReturnStatement" || at?.type === "ArrowFunctionExpression";
          const builder = enclosingFunction(object);
          const declared = returned ? builder?.returnType?.typeAnnotation : undefined;
          const [derived, a, b] = derivedField(object, declared) ?? [];
          const node = declared?.type === "TSTypeLiteral" ? declared : object;
          const name = declaredName(builder);
          const skip = reported.has(node) || (name !== null && ignored(name));
          if (derived === undefined || a === undefined || b === undefined || skip) {
            continue;
          }
          reported.add(node);
          context.report({ node, messageId: "derived", data: { derived, a, b } });
        }
      },
      FunctionDeclaration: (node) => parameters(node, named(node)),
      TSDeclareFunction: (node) => parameters(node, named(node)),
      FunctionExpression: (node) => parameters(node, named(node)),
      ArrowFunctionExpression: (node) => {
        const holder = node.parent;
        const fn =
          holder?.type === "VariableDeclarator" && holder.id.type === "Identifier"
            ? holder.id.name
            : "this function";
        parameters(node, fn);
      },
      TSMethodSignature: (node) => parameters(node, memberName(node.key)),
    };
  },
});
