const CONTROL_BLOCK_TYPES = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "SwitchStatement",
  "TryStatement",
  "WhileStatement",
]);

const CONTROL_TRANSFER_TYPES = new Set(["ContinueStatement", "ReturnStatement", "ThrowStatement"]);

const WHITESPACE_META = {
  type: "layout",
  fixable: "whitespace",
  schema: [],
};

const CODE_META = {
  type: "layout",
  fixable: "code",
  schema: [],
};

function getStartLine(node) {
  return node.loc?.start.line ?? node.loc?.start.lineNumber;
}

function getEndLine(node) {
  return node.loc?.end.line ?? node.loc?.end.lineNumber;
}

function getStartColumn(node) {
  return node.loc?.start.column ?? node.loc?.start.columnNumber;
}

function isLogicalBlock(node) {
  return Boolean(node && CONTROL_BLOCK_TYPES.has(node.type));
}

function isControlTransfer(node) {
  return Boolean(node && CONTROL_TRANSFER_TYPES.has(node.type));
}

function isSingleLine(node) {
  const startLine = getStartLine(node);
  const endLine = getEndLine(node);

  return Boolean(startLine && endLine && startLine === endLine);
}

function isMultiline(node) {
  const startLine = getStartLine(node);
  const endLine = getEndLine(node);

  return Boolean(startLine && endLine && endLine > startLine);
}

function hasBlankLineBetween(sourceCode, previousNode, nextNode) {
  const previousEndLine = getEndLine(previousNode);
  const nextStartLine = getStartLine(nextNode);

  if (!previousEndLine || !nextStartLine) {
    return false;
  }

  const lines = sourceCode.text.split(/\r?\n/);

  return lines.slice(previousEndLine, nextStartLine - 1).some((line) => line.trim() === "");
}

function lineBreak(sourceCode) {
  return sourceCode.text.includes("\r\n") ? "\r\n" : "\n";
}

function insertBlankLineBefore(fixer, sourceCode, node) {
  const column = getStartColumn(node);

  if (column === undefined || !node.range) {
    return null;
  }

  const lineStart = node.range[0] - column;
  const indentation = sourceCode.text.slice(lineStart, node.range[0]);

  if (!/^[\t ]*$/.test(indentation)) {
    return null;
  }

  return fixer.replaceTextRange(
    [lineStart, node.range[0]],
    `${lineBreak(sourceCode)}${indentation}`,
  );
}

function statementListVisitors(check) {
  return {
    BlockStatement(node) {
      check(node.body);
    },
    Program(node) {
      check(node.body);
    },
    SwitchCase(node) {
      check(node.consequent);
    },
  };
}

function isDirectiveComment(comment) {
  return /^(eslint|oxlint|biome|prettier|@ts-|ts-|\/)/.test(comment.value.trim());
}

function isDividerComment(comment) {
  const value = comment.value.trim();

  return value.length >= 3 && /^[-=_*/]+$/.test(value);
}

function isCommentGroupContinuation(previousComment, comment) {
  const previousEndLine = getEndLine(previousComment);
  const startLine = getStartLine(comment);

  return Boolean(previousEndLine && startLine && startLine === previousEndLine + 1);
}

function isStandaloneComment(sourceCode, comment) {
  const column = getStartColumn(comment);

  if (column === undefined || !comment.range) {
    return false;
  }

  const lineStart = comment.range[0] - column;
  const nextLineBreak = sourceCode.text.indexOf("\n", comment.range[1]);
  const lineEnd = nextLineBreak === -1 ? sourceCode.text.length : nextLineBreak;
  const before = sourceCode.text.slice(lineStart, comment.range[0]);
  const after = sourceCode.text.slice(comment.range[1], lineEnd).replace(/\r$/, "");

  return before.trim() === "" && after.trim() === "";
}

const blankLineAfterLogicalBlock = {
  meta: WHITESPACE_META,
  create(context) {
    const sourceCode = context.sourceCode;

    function check(statements) {
      for (let index = 0; index < statements.length - 1; index++) {
        const previousNode = statements[index];
        const nextNode = statements[index + 1];

        if (
          !isLogicalBlock(previousNode) ||
          hasBlankLineBetween(sourceCode, previousNode, nextNode)
        ) {
          continue;
        }

        context.report({
          node: previousNode,
          message: "Expected a blank line after this logical block.",
          fix: (fixer) => insertBlankLineBefore(fixer, sourceCode, nextNode),
        });
      }
    }

    return statementListVisitors(check);
  },
};

const blankLineBeforeControlTransfer = {
  meta: WHITESPACE_META,
  create(context) {
    const sourceCode = context.sourceCode;

    function check(statements) {
      for (let index = 1; index < statements.length; index++) {
        const previousNode = statements[index - 1];
        const nextNode = statements[index];

        if (
          !isControlTransfer(nextNode) ||
          isLogicalBlock(previousNode) ||
          hasBlankLineBetween(sourceCode, previousNode, nextNode)
        ) {
          continue;
        }

        context.report({
          node: nextNode,
          message: "Expected a blank line before this control-transfer statement.",
          fix: (fixer) => insertBlankLineBefore(fixer, sourceCode, nextNode),
        });
      }
    }

    return statementListVisitors(check);
  },
};

const blankLineBetweenSwitchCases = {
  meta: WHITESPACE_META,
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      SwitchStatement(node) {
        for (let index = 1; index < node.cases.length; index++) {
          const previousCase = node.cases[index - 1];
          const switchCase = node.cases[index];

          if (hasBlankLineBetween(sourceCode, previousCase, switchCase)) {
            continue;
          }

          context.report({
            node: switchCase,
            message: "Expected a blank line before this switch case.",
            fix: (fixer) => insertBlankLineBefore(fixer, sourceCode, switchCase),
          });
        }
      },
    };
  },
};

const blankLineBeforeLogicalBlockAfterMultiline = {
  meta: WHITESPACE_META,
  create(context) {
    const sourceCode = context.sourceCode;

    function check(statements) {
      for (let index = 1; index < statements.length; index++) {
        const previousNode = statements[index - 1];
        const nextNode = statements[index];

        if (
          isLogicalBlock(previousNode) ||
          !isMultiline(previousNode) ||
          !isLogicalBlock(nextNode) ||
          hasBlankLineBetween(sourceCode, previousNode, nextNode)
        ) {
          continue;
        }

        context.report({
          node: nextNode,
          message: "Expected a blank line between the multi-line statement and this logical block.",
          fix: (fixer) => insertBlankLineBefore(fixer, sourceCode, nextNode),
        });
      }
    }

    return statementListVisitors(check);
  },
};

const useJsdocForMultilineBlockComments = {
  meta: CODE_META,
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program(node) {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== "Block" || isSingleLine(comment) || comment.value.startsWith("*")) {
            continue;
          }

          context.report({
            node,
            loc: comment.loc.start,
            message: "Expected multi-line block comments to use JSDoc syntax.",
            fix: comment.range
              ? (fixer) => fixer.replaceTextRange([comment.range[0], comment.range[0] + 2], "/**")
              : undefined,
          });
        }
      },
    };
  },
};

const useJsdocForMultilineLineComments = {
  meta: CODE_META,
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program(node) {
        const comments = sourceCode.getAllComments();
        let group = [];

        function reportGroup() {
          if (group.length < 2 || group.some(isDirectiveComment) || group.some(isDividerComment)) {
            return;
          }

          const firstComment = group[0];
          const lastComment = group.at(-1);
          const column = getStartColumn(firstComment);
          const canFix =
            column !== undefined &&
            firstComment.range &&
            lastComment.range &&
            group.every(
              (comment) =>
                getStartColumn(comment) === column && isStandaloneComment(sourceCode, comment),
            );

          context.report({
            node,
            loc: {
              start: firstComment.loc.start,
              end: lastComment.loc.end,
            },
            message: "Expected multi-line // comment groups to use JSDoc syntax.",
            fix: canFix
              ? (fixer) => {
                  const indentation = " ".repeat(column);
                  const lines = group.map((comment) => comment.value.replace(/^ /, "").trimEnd());
                  const replacement = [
                    "/**",
                    ...lines.map((line) => `${indentation} *${line ? ` ${line}` : ""}`),
                    `${indentation} */`,
                  ].join(lineBreak(sourceCode));

                  return fixer.replaceTextRange(
                    [firstComment.range[0], lastComment.range[1]],
                    replacement,
                  );
                }
              : undefined,
          });
        }

        for (const comment of comments) {
          if (comment.type !== "Line") {
            reportGroup();
            group = [];

            continue;
          }

          const previousComment = group.at(-1);

          if (previousComment && !isCommentGroupContinuation(previousComment, comment)) {
            reportGroup();
            group = [];
          }

          group.push(comment);
        }

        reportGroup();
      },
    };
  },
};

function isFunctionNode(node) {
  return Boolean(node && ["ArrowFunctionExpression", "FunctionExpression"].includes(node.type));
}

function isExportDeclaration(node) {
  return Boolean(
    node && ["ExportDefaultDeclaration", "ExportNamedDeclaration"].includes(node.type),
  );
}

const useJsdocForFunctionComments = {
  meta: CODE_META,
  create(context) {
    const sourceCode = context.sourceCode;
    const lineCommentsByEndLine = new Map();

    for (const comment of sourceCode.getAllComments()) {
      if (comment.type === "Line") {
        lineCommentsByEndLine.set(getEndLine(comment), comment);
      }
    }

    function check(node) {
      // The comment sits above the export keyword when the function is exported.
      const target = isExportDeclaration(node.parent) ? node.parent : node;
      const startLine = getStartLine(target);
      const comment = lineCommentsByEndLine.get(startLine - 1);

      if (
        !comment ||
        isDirectiveComment(comment) ||
        isDividerComment(comment) ||
        !isStandaloneComment(sourceCode, comment)
      ) {
        return;
      }

      // use-jsdoc-for-multiline-line-comments reports groups of two or more // lines.
      if (lineCommentsByEndLine.has(startLine - 2)) {
        return;
      }

      context.report({
        node: target,
        loc: comment.loc.start,
        message: "Expected comments above functions to use JSDoc syntax.",
        fix: comment.range
          ? (fixer) => fixer.replaceTextRange(comment.range, `/** ${comment.value.trim()} */`)
          : undefined,
      });
    }

    return {
      FunctionDeclaration: check,
      MethodDefinition: check,
      VariableDeclaration(node) {
        if (node.declarations.length === 1 && isFunctionNode(node.declarations[0].init)) {
          check(node);
        }
      },
    };
  },
};

const useLineCommentForSingleLineComments = {
  meta: CODE_META,
  create(context) {
    const sourceCode = context.sourceCode;
    const jsxCommentRanges = [];

    return {
      JSXEmptyExpression(node) {
        jsxCommentRanges.push(node.range);
      },
      "Program:exit"(node) {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== "Block" || !isSingleLine(comment) || comment.value.startsWith("*")) {
            continue;
          }

          if (
            jsxCommentRanges.some(
              (range) => range[0] <= comment.range[0] && range[1] >= comment.range[1],
            )
          ) {
            continue;
          }

          context.report({
            node,
            loc: comment.loc.start,
            message: "Expected single-line comments to use // syntax.",
            fix:
              comment.range && isStandaloneComment(sourceCode, comment)
                ? (fixer) => fixer.replaceTextRange(comment.range, `//${comment.value.trimEnd()}`)
                : undefined,
          });
        }
      },
    };
  },
};

export default {
  meta: {
    name: "code-style",
  },
  rules: {
    "blank-line-after-logical-block": blankLineAfterLogicalBlock,
    "blank-line-before-control-transfer": blankLineBeforeControlTransfer,
    "blank-line-between-switch-cases": blankLineBetweenSwitchCases,
    "blank-line-before-logical-block-after-multiline": blankLineBeforeLogicalBlockAfterMultiline,
    "use-jsdoc-for-function-comments": useJsdocForFunctionComments,
    "use-jsdoc-for-multiline-block-comments": useJsdocForMultilineBlockComments,
    "use-jsdoc-for-multiline-line-comments": useJsdocForMultilineLineComments,
    "use-line-comment-for-single-line-comments": useLineCommentForSingleLineComments,
  },
};
