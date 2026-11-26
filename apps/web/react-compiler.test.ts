import { transformSync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The source files that the app builds. The shadcn components are kept as upstream ships them. */
const sourceFiles = readdirSync(join(import.meta.dir, "src"), { recursive: true })
  .map(String)
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".gen.ts"))
  .filter((file) => !file.startsWith("components/ui/"));

/**
 * Lists the components and hooks in a file that the compiler skips. Lint reports most of these
 * bailouts, but not all, and a skipped component still builds, only without memoization.
 */
const findBailouts = (file: string) => {
  const bailouts: string[] = [];
  const path = join(import.meta.dir, "src", file);

  transformSync(readFileSync(path, "utf8"), {
    filename: path,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [
      [
        reactCompiler,
        {
          panicThreshold: "none",
          logger: {
            logEvent: (
              _file: string,
              event: { kind: string; fnName?: string; detail?: unknown },
            ) => {
              if (event.kind === "CompileError" || event.kind === "PipelineError") {
                bailouts.push(`${event.fnName ?? "(anonymous)"}: ${String(event.detail)}`);
              }
            },
          },
        },
      ],
    ],
  });

  return bailouts;
};

describe("React Compiler", () => {
  test.each(sourceFiles)("compiles %s", (file) => {
    expect(findBailouts(file)).toEqual([]);
  });
});
