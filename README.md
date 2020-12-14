# `eslint-plugin-padding`

This rule allows/disallows spacing between two given statements. Spacing generally helps
readability. This rule is a generalized version of the
[`eslint/padding-line-between-statements`](https://eslint.org/docs/rules/padding-line-between-statements)
rule and can also be used to replace
[eslint/lines-between-class-members](https://eslint.org/docs/rules/lines-between-class-members).

### Syntax

```json
{
    "padding/spacing": [
        "error",
        { "blankLine": LINEBREAK_TYPE, "prev": STATEMENT_TYPE, "next": STATEMENT_TYPE },
        { "blankLine": LINEBREAK_TYPE, "prev": STATEMENT_TYPE, "next": STATEMENT_TYPE },
        { "blankLine": LINEBREAK_TYPE, "prev": STATEMENT_TYPE, "next": STATEMENT_TYPE },
        { "blankLine": LINEBREAK_TYPE, "prev": STATEMENT_TYPE, "next": STATEMENT_TYPE },
        ...
    ]
}
```

- `LINEBREAK_TYPE` is one of the following.

  - `"any"` just ignores the statement pair.
  - `"never"` disallows blank lines.
  - `"always"` requires one or more blank lines. Note it does not count lines that comments exist as
    blank lines. te it does not count lines that comments exist as blank lines.

- `STATEMENT_TYPE` is one (or an array) of the following:

  1. A space-delimited list of keyword (e.g. `"const"`, `"export const"`, or `"class"`)
  2. One of the following:

     - `"*"` is wildcard. This matches any statements.
     - `"block-like"` - block like statements. This matches statements that the last token is the
       closing brace of blocks; e.g. `{ }`, `if (a) { }`, and `while (a) { }`. Also matches immediately
       invoked function expression statements.
     - `"exports"` - `export` statements of CommonJS; e.g. `module.exports = 0`,
       `module.exports.foo = 1`, and `exports.foo = 2`.
     - `"require"` - `require` statements of CommonJS; e.g. `const foo = require("foo")`.
     - `"directive"` - directive prologues. This matches directives; e.g. `"use strict"`.
     - `"iife"` - immediately invoked function expression statements. This matches calls on a function
       expression, optionally prefixed with a unary operator.
  - An object of the form

    ```json
    {
      "type": NODE_TYPE | undefined,
      "keyword": KEYWORD | undefined,
      "inline": boolean | undefined
    }
    ```

    where

    - `NODE_TYPE` is the name of an `ESTree` node type, e.g. `"FunctionDeclaration"`. You can use an
      [`AST explorer`](https://astexplorer.net) to get the name of a particular node.
    - `KEYWORD` is one (or an array) of either (1) or (2).
    - `"inline"` denotes where to validate nodes that are span multiple lines (`false`) or a single
      line (`true`)

## When Not To Use It

If you don't want to notify warnings about linebreaks, then it's safe to disable this rule.

<sup>Taken with ❤️
[from ESLint core](https://eslint.org/docs/rules/padding-line-between-statements#require-or-disallow-padding-lines-between-statements-padding-line-between-statements)</sup>
