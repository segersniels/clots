import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  botPlugins,
  botSkillsSignature,
  deleteBotSkill,
  readBotSkills,
  saveBotSkill,
  showOwnSkills,
  toOwnSkills,
  writeBotSkills,
} from "./BotPlugin.ts";
import type { StoredBot } from "./BotRepository.ts";

/** Makes a bot with a new, empty notes directory. Only the directory matters here. */
const newBot = () =>
  ({ workingDirectory: mkdtempSync(join(tmpdir(), "clots-plugin-")) }) as StoredBot;

const seo = {
  name: "SEO",
  description: "When a page needs search traffic: titles, links.",
  body: "\nCheck the title.\n",
};

test("a bot without skills gets no plugin", () => {
  const bot = newBot();
  writeBotSkills(bot, []);

  expect(botPlugins(bot)).toEqual([]);
  expect(toOwnSkills(bot, "/seo now")).toBe("/seo now");
});

test("writes the skills as the bot's own plugin", () => {
  const bot = newBot();
  writeBotSkills(bot, [seo]);
  const folder = join(bot.workingDirectory, "plugin");

  expect(botPlugins(bot)).toEqual([{ type: "local", path: folder }]);
  expect(JSON.parse(readFileSync(join(folder, ".claude-plugin", "plugin.json"), "utf8"))).toEqual({
    name: "bot",
  });
  expect(readFileSync(join(folder, "skills", "seo", "SKILL.md"), "utf8")).toBe(
    '---\nname: seo\ndescription: "When a page needs search traffic: titles, links."\n---\n\nCheck the title.\n',
  );
});

test("an own skill shows by its bare name and hides another skill of that name", () => {
  const skills = [
    { name: "seo", description: "The operator's seo. (user)" },
    { name: "vercel:deploy", description: "(vercel) Deploy." },
    { name: "kiss", description: "Keep it small (for a fix). (project)" },
    { name: "bot:seo", description: "(bot) The bot's seo." },
  ];

  expect(showOwnSkills(skills)).toEqual([
    { name: "vercel:deploy", description: "(vercel) Deploy." },
    { name: "kiss", description: "Keep it small (for a fix)." },
    { name: "seo", description: "The bot's seo.", replaces: true },
  ]);
});

test("a prompt names the bot's own skills in full", () => {
  const bot = newBot();
  writeBotSkills(bot, [seo]);

  expect(toOwnSkills(bot, "/seo the docs, then /review and /seo.")).toBe(
    "/bot:seo the docs, then /review and /bot:seo.",
  );
  expect(toOwnSkills(bot, "see a/seo or /seop or /bot:seo")).toBe("see a/seo or /seop or /bot:seo");
});

test("the first own skill of a bot without a template makes its plugin", () => {
  const bot = newBot();

  expect(
    saveBotSkill(bot, { name: "seo", description: "Titles: short.", body: "Check the title." }),
  ).toBeUndefined();
  expect(botPlugins(bot)).toHaveLength(1);
  expect(readBotSkills(bot)).toEqual([
    { name: "seo", description: "Titles: short.", body: "Check the title." },
  ]);
});

test("a skill name must be a slug without path parts", () => {
  const bot = newBot();

  for (const name of ["../seo", "SEO", "a/b", "", "-seo", "a".repeat(65)]) {
    expect(saveBotSkill(bot, { name, description: "d", body: "b" })).toBe("name");
  }

  expect(deleteBotSkill(bot, "..")).toBe("name");
  expect(botPlugins(bot)).toEqual([]);
});

test("a new skill does not replace one of the same name", () => {
  const bot = newBot();
  writeBotSkills(bot, [seo]);

  expect(saveBotSkill(bot, { name: "seo", description: "d", body: "b" })).toBe("taken");
});

test("a rename moves the folder with its other files, and an edit keeps the bot's own fields", () => {
  const bot = newBot();
  writeBotSkills(bot, [seo]);
  const folder = join(bot.workingDirectory, "plugin", "skills");
  writeFileSync(
    join(folder, "seo", "SKILL.md"),
    "---\nname: seo\nallowed-tools:\n  - Read\ndescription: old\n---\nOld steps.\n",
  );
  writeFileSync(join(folder, "seo", "notes.md"), "kept");

  expect(
    saveBotSkill(bot, { name: "search", description: "New.", body: "New steps." }, "seo"),
  ).toBeUndefined();
  expect(existsSync(join(folder, "seo"))).toBe(false);
  expect(readFileSync(join(folder, "search", "notes.md"), "utf8")).toBe("kept");
  expect(readFileSync(join(folder, "search", "SKILL.md"), "utf8")).toBe(
    '---\nname: search\ndescription: "New."\nallowed-tools:\n  - Read\n---\n\nNew steps.\n',
  );
  expect(saveBotSkill(bot, { name: "x", description: "d", body: "b" }, "seo")).toBe("missing");
});

test("a delete removes the skill, and the signature follows every change", () => {
  const bot = newBot();
  writeBotSkills(bot, [seo, { name: "posts", description: "d", body: "b" }]);
  const before = botSkillsSignature(bot);

  expect(readBotSkills(bot).map((skill) => skill.name)).toEqual(["posts", "seo"]);
  expect(deleteBotSkill(bot, "seo")).toBeUndefined();
  expect(readBotSkills(bot).map((skill) => skill.name)).toEqual(["posts"]);
  expect(botSkillsSignature(bot)).not.toBe(before);
  expect(deleteBotSkill(bot, "seo")).toBe("missing");
});

test("a skill file without valid frontmatter still shows its body", () => {
  const bot = newBot();
  writeBotSkills(bot, [seo]);
  const file = join(bot.workingDirectory, "plugin", "skills", "seo", "SKILL.md");

  writeFileSync(file, "Just steps.");
  expect(readBotSkills(bot)).toEqual([{ name: "seo", description: "", body: "Just steps." }]);

  writeFileSync(file, "---\ndescription: [unclosed\n---\nSteps.");
  expect(readBotSkills(bot)).toEqual([{ name: "seo", description: "", body: "Steps." }]);
});
