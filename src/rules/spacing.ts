import {
  AST_NODE_TYPES,
  TSESLint,
  TSESTree,
  ASTUtils,
  ESLintUtils,
  AST_TOKEN_TYPES,
} from "@typescript-eslint/experimental-utils";

// ------------------------------------------------------------------------------
// Local Types
// ------------------------------------------------------------------------------

type NodeTest = (node: TSESTree.Node, sourceCode: TSESLint.SourceCode) => boolean;

interface NodeTestObject {
  test: NodeTest;
}

type StatementType =
  | string
  | {
      type?: AST_NODE_TYPES | AST_NODE_TYPES[];
      keyword?: string | string[];
      inline?: boolean;
      comment?: boolean | "line" | "block";
    };

export interface PaddingOption {
  blankLine: keyof typeof PaddingTypes;
  prev: StatementType | StatementType[];
  next: StatementType | StatementType[];
}

type MessageIds = "expectedBlankLine" | "unexpectedBlankLine";

type Options = PaddingOption[];

// ------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------

const LT = `[${Array.from(new Set(["\r\n", "\r", "\n", "\u2028", "\u2029"])).join("")}]`;

const PADDING_LINE_SEQUENCE = new RegExp(String.raw`^(\s*?${LT})\s*${LT}(\s*;?)$`, "u");

/**
 * Skips a chain expression node
 * @param node - The node to test
 * @returns A non-chain expression
 * @internal
 */
function skipChainExpression(node: TSESTree.Node): TSESTree.Node {
  return node && node.type === AST_NODE_TYPES.ChainExpression ? node.expression : node;
}

/**
 * Creates tester which check if a node starts with specific keyword.
 * @param keyword - The keyword to test.
 * @returns the created tester.
 * @internal
 */
class KeywordTester implements NodeTestObject {
  private static cache = new Map<string, KeywordTester>();

  public test: (node: TSESTree.Node, sourceCode: TSESLint.SourceCode) => boolean;

  constructor(keyword: string) {
    this.test = (node, sourceCode) => {
      return keyword.split(" ").every((kw, i) => sourceCode.getFirstToken(node, i)?.value === kw);
    };
  }

  public static test(type: string, node: TSESTree.Node, sourceCode: TSESLint.SourceCode) {
    let kt = KeywordTester.cache.get(type);

    if (!kt) {
      kt = new KeywordTester(type);
      KeywordTester.cache.set(type, kt);
    }

    return kt.test(node, sourceCode);
  }
}

/**
 * Creates tester which check if a node is specific type.
 * @param type - The node type to test.
 * @returns the created tester.
 * @internal
 */
class NodeTypeTester implements NodeTestObject {
  private static cache = new Map<AST_NODE_TYPES, NodeTypeTester>();

  public test: (node: TSESTree.Node) => boolean;

  constructor(type: AST_NODE_TYPES) {
    this.test = (node) => node.type === type;
  }

  public static test(type: AST_NODE_TYPES, node: TSESTree.Node) {
    let ntt = NodeTypeTester.cache.get(type);

    if (!ntt) {
      ntt = new NodeTypeTester(type);
      NodeTypeTester.cache.set(type, ntt);
    }

    return ntt.test(node);
  }
}

/**
 * Checks the given node is an expression statement of IIFE.
 * @param node - The node to check.
 * @returns `true` if the node is an expression statement of IIFE.
 * @internal
 */
function isIIFEStatement(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.ExpressionStatement) {
    node = skipChainExpression(node.expression);

    if (node.type === AST_NODE_TYPES.UnaryExpression) {
      node = skipChainExpression(node.argument);
    }

    if (node.type === AST_NODE_TYPES.CallExpression) {
      node = node.callee as TSESTree.Node;
      while (node.type === AST_NODE_TYPES.SequenceExpression) {
        node = node.expressions[node.expressions.length - 1];
      }
    }

    return ASTUtils.isFunction(node);
  }

  return false;
}

/**
 * Checks the given node is a CommonJS require statement
 * @param node - The node to check.
 * @returns `true` if the node is a CommonJS require statement.
 * @internal
 */
function isCJSRequire(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.VariableDeclaration) {
    node = node.declarations[0] as TSESTree.VariableDeclarator;

    if (node?.init) {
      node = node?.init;
      while (node.type === AST_NODE_TYPES.MemberExpression) {
        node = node.object;
      }

      if (
        node.type === AST_NODE_TYPES.CallExpression &&
        node.callee.type === AST_NODE_TYPES.Identifier
      ) {
        return node.callee.name === "require";
      }
    }
  }

  return false;
}

/**
 * Checks the given node is a CommonJS export statement
 * @param node - The node to check.
 * @returns `true` if the node is a CommonJS export statement.
 * @internal
 */
function isCJSExport(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.ExpressionStatement) {
    node = node.expression;

    if (node.type === AST_NODE_TYPES.AssignmentExpression) {
      node = node.left;

      if (node.type === AST_NODE_TYPES.MemberExpression) {
        while (node.object.type === AST_NODE_TYPES.MemberExpression) {
          node = node.object;
        }

        return (
          node.object.type === AST_NODE_TYPES.Identifier &&
          (node.object.name === "exports" ||
            (node.object.name === "module" &&
              node.property.type === AST_NODE_TYPES.Identifier &&
              node.property.name === "exports"))
        );
      }
    }
  }

  return false;
}

/**
 * Checks whether the given node is a block-like statement.
 * This checks the last token of the node is the closing brace of a block.
 * @param sourceCode - The source code to get tokens.
 * @param node - The node to check.
 * @returns `true` if the node is a block-like statement.
 * @internal
 */
function isBlockLikeStatement(node: TSESTree.Node, sourceCode: TSESLint.SourceCode): boolean {
  // do-while with a block is a block-like statement.
  if (
    node.type === AST_NODE_TYPES.DoWhileStatement &&
    node.body.type === AST_NODE_TYPES.BlockStatement
  ) {
    return true;
  }

  /**
   * IIFE is a block-like statement specially from
   * JSCS#disallowPaddingNewLinesAfterBlocks.
   */
  if (isIIFEStatement(node)) {
    return true;
  }

  // Checks the last token is a closing brace of blocks.
  const lastToken = sourceCode.getLastToken(node, ASTUtils.isNotSemicolonToken);

  const belongingNode =
    lastToken && ASTUtils.isClosingBraceToken(lastToken)
      ? sourceCode.getNodeByRangeIndex(lastToken.range[0])
      : null;

  return (
    !!belongingNode &&
    (belongingNode.type === AST_NODE_TYPES.BlockStatement ||
      belongingNode.type === AST_NODE_TYPES.SwitchStatement)
  );
}

/**
 * Check whether the given node is a directive or not.
 * @param node - The node to check.
 * @param sourceCode - The source code object to get tokens.
 * @returns `true` if the node is a directive.
 */
function isDirective(node: TSESTree.Node, sourceCode: TSESLint.SourceCode): boolean {
  return (
    node.type === AST_NODE_TYPES.ExpressionStatement &&
    (node.parent?.type === AST_NODE_TYPES.Program ||
      (node.parent?.type === AST_NODE_TYPES.BlockStatement &&
        ASTUtils.isFunction(node.parent.parent))) &&
    node.expression.type === AST_NODE_TYPES.Literal &&
    typeof node.expression.value === "string" &&
    !ASTUtils.isParenthesized(node.expression, sourceCode)
  );
}

/**
 * Check whether the given node is a part of directive prologue or not.
 * @param node - The node to check.
 * @param sourceCode - The source code object to get tokens.
 * @returns `true` if the node is a part of directive prologue.
 */
function isDirectivePrologue(node: TSESTree.Node, sourceCode: TSESLint.SourceCode): boolean {
  if (
    isDirective(node, sourceCode) &&
    node.parent &&
    "body" in node.parent &&
    Array.isArray(node.parent.body)
  ) {
    for (const sibling of node.parent.body) {
      if (sibling === node) break;

      if (!isDirective(sibling, sourceCode)) return false;
    }

    return true;
  }

  return false;
}

/**
 * Check whether the given node is an expression
 * @param node - The node to check.
 * @param sourceCode - The source code object to get tokens.
 * @returns `true` if the node is an expression
 */
function isExpression(node: TSESTree.Node, sourceCode: TSESLint.SourceCode): boolean {
  return node.type === AST_NODE_TYPES.ExpressionStatement && !isDirectivePrologue(node, sourceCode);
}

/**
 * Gets the actual last token.
 *
 * If a semicolon is semicolon-less style's semicolon, this ignores it.
 * For example:
 *
 *     foo()
 *     ;[1, 2, 3].forEach(bar)
 * @param sourceCode - The source code to get tokens.
 * @param node - The node to get.
 * @returns The actual last token.
 * @internal
 */
function getActualLastToken(
  node: TSESTree.Node,
  sourceCode: TSESLint.SourceCode
): TSESTree.Token | null {
  const semiToken = sourceCode.getLastToken(node)!;

  const prevToken = sourceCode.getTokenBefore(semiToken);

  const nextToken = sourceCode.getTokenAfter(semiToken);

  const isSemicolonLessStyle =
    prevToken &&
    nextToken &&
    prevToken.range[0] >= node.range[0] &&
    ASTUtils.isSemicolonToken(semiToken) &&
    semiToken.loc.start.line !== prevToken.loc.end.line &&
    semiToken.loc.end.line === nextToken.loc.start.line;

  return isSemicolonLessStyle ? prevToken : semiToken;
}

/**
 * This returns the concatenation of the first 2 captured strings.
 * @param _ - Unused. Whole matched string.
 * @param trailingSpaces - The trailing spaces of the first line.
 * @param indentSpaces - The indentation spaces of the last line.
 * @returns The concatenation of trailingSpaces and indentSpaces.
 * @internal
 */
function replacerToRemovePaddingLines(
  _: string,
  trailingSpaces: string,
  indentSpaces: string
): string {
  return trailingSpaces + indentSpaces;
}

/**
 * Check and report statements for `any` configuration.
 * It does nothing.
 * @returns
 * @internal
 */
function verifyForAny(): void {
  // Empty
}

/**
 * Check and report statements for `never` configuration.
 * This auto-fix removes blank lines between the given 2 statements.
 * However, if comments exist between 2 blank lines, it does not remove those
 * blank lines automatically.
 * @param context - The rule context to report.
 * @param _ - Unused. The previous node to check.
 * @param nextNode - The next node to check.
 * @param paddingLines - The array of token pairs that blank
 * lines exist between the pair.
 * @returns
 * @internal
 */
function verifyForNever(
  context: TSESLint.RuleContext<MessageIds, Options>,
  _: TSESTree.Node,
  nextNode: TSESTree.Node,
  paddingLines: [TSESTree.Token, TSESTree.Token][]
): void {
  if (paddingLines.length === 0) {
    return;
  }

  context.report({
    node: nextNode,
    messageId: "unexpectedBlankLine",
    fix(fixer) {
      if (paddingLines.length >= 2) {
        return null;
      }

      const prevToken = paddingLines[0][0];

      const nextToken = paddingLines[0][1];

      const start = prevToken.range[1];

      const end = nextToken.range[0];

      const text = context
        .getSourceCode()
        .text.slice(start, end)
        .replace(PADDING_LINE_SEQUENCE, replacerToRemovePaddingLines);

      return fixer.replaceTextRange([start, end], text);
    },
  });
}

/**
 * Check and report statements for `always` configuration.
 * This auto-fix inserts a blank line between the given 2 statements.
 * If the `prevNode` has trailing comments, it inserts a blank line after the
 * trailing comments.
 * @param context - The rule context to report.
 * @param prevNode - The previous node to check.
 * @param nextNode - The next node to check.
 * @param paddingLines - The array of token pairs that blank
 * lines exist between the pair.
 * @returns
 * @internal
 */
function verifyForAlways(
  context: TSESLint.RuleContext<MessageIds, Options>,
  prevNode: TSESTree.Node,
  nextNode: TSESTree.Node,
  paddingLines: [TSESTree.Token, TSESTree.Token][]
): void {
  if (paddingLines.length > 0) {
    return;
  }

  context.report({
    node: nextNode,
    messageId: "expectedBlankLine",
    fix(fixer) {
      const sourceCode = context.getSourceCode();

      let prevToken = getActualLastToken(prevNode, sourceCode) as TSESTree.Token;

      const nextToken =
        (sourceCode.getFirstTokenBetween(prevToken, nextNode, {
          includeComments: true,

          /**
           * Skip the trailing comments of the previous node.
           * This inserts a blank line after the last trailing comment.
           *
           * For example:
           *
           *     foo(); // trailing comment.
           *     // comment.
           *     bar();
           *
           * Get fixed to:
           *
           *     foo(); // trailing comment.
           *
           *     // comment.
           *     bar();
           * @param token - The token to check.
           * @returns `true` if the token is not a trailing comment.
           * @internal
           */
          filter(token) {
            if (ASTUtils.isTokenOnSameLine(prevToken, token)) {
              prevToken = token;

              return false;
            }

            return true;
          },
        }) as TSESTree.Token) || nextNode;

      const insertText = ASTUtils.isTokenOnSameLine(prevToken, nextToken) ? "\n\n" : "\n";

      return fixer.insertTextAfter(prevToken, insertText);
    },
  });
}

/**
 * Types of blank lines.
 * `any`, `never`, and `always` are defined.
 * Those have `verify` method to check and report statements.
 * @internal
 */
const PaddingTypes = {
  any: { verify: verifyForAny },
  never: { verify: verifyForNever },
  always: { verify: verifyForAlways },
};

/**
 * Types of statements.
 * Those have `test` method to check it matches to the given statement.
 * @internal
 */
const StatementTypes: Record<string, NodeTestObject> = {
  "*": { test: (): boolean => true },
  "block-like": { test: isBlockLikeStatement },
  "exports": { test: isCJSExport },
  "require": { test: isCJSRequire },
  "directive": { test: isDirectivePrologue },
  "expression": { test: isExpression },
  "iife": { test: isIIFEStatement },
};

// ------------------------------------------------------------------------------
// Rule Definition
// ------------------------------------------------------------------------------

export default ESLintUtils.RuleCreator((name) => `https://github.com/mu-io/${name}`)<
  Options,
  MessageIds
>({
  name: "spacing",
  meta: {
    type: "layout",
    docs: {
      description: "requires or disallows spacing between statements",
      category: "Stylistic Issues",
      recommended: false,
    },
    fixable: "whitespace",
    schema: {
      definitions: {
        keyword: { type: "string" },
        nodeType: {
          enum: Object.values(AST_NODE_TYPES),
        },
        paddingType: {
          enum: Object.keys(PaddingTypes),
        },
        statementType: {
          anyOf: [
            { $ref: "#/definitions/keyword" },
            {
              type: "object",
              properties: {
                keyword: {
                  anyOf: [
                    { $ref: "#/definitions/keyword" },
                    {
                      type: "array",
                      items: { $ref: "#/definitions/keyword" },
                      uniqueItems: true,
                      minItems: 1,
                      additionalItems: false,
                    },
                  ],
                },
                inline: {
                  type: "boolean",
                },
                comment: {
                  anyOf: [{ type: "boolean" }, { enum: ["line", "block"] }],
                },
                type: {
                  anyOf: [
                    { $ref: "#/definitions/nodeType" },
                    {
                      type: "array",
                      items: { $ref: "#/definitions/nodeType" },
                      uniqueItems: true,
                      minItems: 1,
                      additionalItems: false,
                    },
                  ],
                },
              },
              minProperties: 1,
              additionalProperties: false,
            },
          ],
        },
      },
      type: "array",
      items: {
        type: "object",
        properties: {
          blankLine: { $ref: "#/definitions/paddingType" },
          prev: {
            anyOf: [
              { $ref: "#/definitions/statementType" },
              {
                type: "array",
                items: { $ref: "#/definitions/statementType" },
                minItems: 1,
                additionalItems: false,
              },
            ],
          },
          next: { $ref: "#/items/properties/prev" },
        },
        additionalProperties: false,
        required: ["blankLine", "prev", "next"],
      },
      additionalItems: false,
    },
    messages: {
      unexpectedBlankLine: "Unexpected blank line before this statement.",
      expectedBlankLine: "Expected blank line before this statement.",
    },
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.getSourceCode();

    const configureList = context.options || [];

    type Scope = null | {
      upper: Scope;
      prevNode: TSESTree.Node | null;
    };

    let scopeInfo: Scope = null;

    /**
     * Processes to enter to new scope.
     * This manages the current previous statement.
     * @returns
     * @internal
     */
    function enterScope(): void {
      scopeInfo = {
        upper: scopeInfo,
        prevNode: null,
      };
    }

    /**
     * Processes to exit from the current scope.
     * @returns
     * @internal
     */
    function exitScope(): void {
      if (scopeInfo) {
        scopeInfo = scopeInfo.upper;
      }
    }

    function normalizeStatementType(type: StatementType) {
      const nType: {
        type?: AST_NODE_TYPES[];
        keyword?: string[];
        inline?: boolean;
        comment?: boolean | "line" | "block";
      } = {};

      if (typeof type === "string") {
        return { keyword: [type] };
      }

      if (type.keyword !== undefined) {
        nType.keyword = Array.isArray(type.keyword) ? type.keyword : [type.keyword];
      }

      if (type.type !== undefined) {
        nType.type = Array.isArray(type.type) ? type.type : [type.type];
      }

      if (type.inline !== undefined) {
        nType.inline = type.inline;
      }

      if (type.comment !== undefined) {
        nType.comment = type.comment;
      }

      return nType;
    }

    /**
     * Checks whether the given node matches the given type.
     * @param node - The statement node to check.
     * @param type - The statement type to check.
     * @returns `true` if the statement node matched the type.
     * @internal
     */
    function match(node: TSESTree.Node, type: StatementType | StatementType[]): boolean {
      let innerStatementNode = node;

      while (innerStatementNode.type === AST_NODE_TYPES.LabeledStatement) {
        innerStatementNode = innerStatementNode.body;
      }

      type = !Array.isArray(type) ? [type] : type;

      return type.some((t) => {
        const nType = normalizeStatementType(t);

        if (nType.inline !== undefined) {
          if (nType.inline) {
            if (node.loc.start.line !== node.loc.end.line) {
              return false;
            }
          } else if (node.loc.start.line === node.loc.end.line) {
            return false;
          }
        }

        if (nType.comment !== undefined) {
          const comments = sourceCode.getCommentsBefore(innerStatementNode).pop();

          switch (nType.comment) {
            case "block":
              if (!comments || comments.type !== AST_TOKEN_TYPES.Block) return false;

              break;
            case "line":
              if (!comments || comments.type !== AST_TOKEN_TYPES.Line) return false;

              break;
            case true:
              if (!comments) return false;

              break;
            case false:
              if (comments) return false;

              break;
            default:
          }
        }

        return (
          (!nType.type || nType.type.some((tt) => NodeTypeTester.test(tt, innerStatementNode))) &&
          (!nType.keyword ||
            nType.keyword.some((tt) =>
              tt in StatementTypes
                ? StatementTypes[tt].test(innerStatementNode, sourceCode)
                : KeywordTester.test(tt, innerStatementNode, sourceCode)
            ))
        );
      });
    }

    /**
     * Finds the last matched configure from configureList.
     * @param prevNode - The previous statement to match.
     * @param nextNode - The current statement to match.
     * @returns The tester of the last matched configure.
     * @internal
     */
    function getPaddingType(
      prevNode: TSESTree.Node,
      nextNode: TSESTree.Node
    ): typeof PaddingTypes[keyof typeof PaddingTypes] {
      for (let i = configureList.length - 1; i >= 0; --i) {
        const configure = configureList[i];

        if (match(prevNode, configure.prev) && match(nextNode, configure.next)) {
          return PaddingTypes[configure.blankLine];
        }
      }

      return PaddingTypes.any;
    }

    /**
     * Gets padding line sequences between the given 2 statements.
     * Comments are separators of the padding line sequences.
     * @param prevNode - The previous statement to count.
     * @param nextNode - The current statement to count.
     * @returns The array of token pairs.
     * @internal
     */
    function getPaddingLineSequences(
      prevNode: TSESTree.Node,
      nextNode: TSESTree.Node
    ): [TSESTree.Token, TSESTree.Token][] {
      const pairs: [TSESTree.Token, TSESTree.Token][] = [];

      let prevToken: TSESTree.Token = getActualLastToken(prevNode, sourceCode)!;

      if (nextNode.loc.start.line - prevToken.loc.end.line >= 2) {
        do {
          const token: TSESTree.Token = sourceCode.getTokenAfter(prevToken, {
            includeComments: true,
          })!;

          if (token.loc.start.line - prevToken.loc.end.line >= 2) {
            pairs.push([prevToken, token]);
          }

          prevToken = token;
        } while (prevToken.range[0] < nextNode.range[0]);
      }

      return pairs;
    }

    /**
     * Verify padding lines between the given node and the previous node.
     * @param node - The node to verify.
     * @returns
     * @internal
     */
    function verify(node: TSESTree.Node): void {
      if (
        !node.parent ||
        ![
          AST_NODE_TYPES.SwitchStatement,
          AST_NODE_TYPES.BlockStatement,
          AST_NODE_TYPES.Program,
          AST_NODE_TYPES.SwitchCase,
        ].includes(node.parent.type)
      ) {
        return;
      }

      // Save this node as the current previous statement.
      const { prevNode } = scopeInfo!;

      // Verify.
      if (prevNode) {
        const type = getPaddingType(prevNode, node);

        const paddingLines = getPaddingLineSequences(prevNode, node);

        type.verify(context, prevNode, node, paddingLines);
      }

      scopeInfo!.prevNode = node;
    }

    /**
     * Verify padding lines between the given node and the previous node.
     * Then process to enter to new scope.
     * @param node - The node to verify.
     * @returns
     * @internal
     */
    function verifyThenEnterScope(node: TSESTree.Node): void {
      verify(node);
      enterScope();
    }

    return {
      "Program": enterScope,
      "BlockStatement": enterScope,
      "SwitchStatement": enterScope,
      "Program:exit": exitScope,
      "BlockStatement:exit": exitScope,
      "SwitchStatement:exit": exitScope,

      ":statement": verify,

      "SwitchCase": verifyThenEnterScope,
      "SwitchCase:exit": exitScope,
    };
  },
});
