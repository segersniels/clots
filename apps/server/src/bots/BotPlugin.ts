import type { BotSkill, InvalidSkill } from "@clots/contracts";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { StoredBot } from "./BotRepository.ts";

/**
 * Names the plugin of every bot. Claude Code calls each skill `/bot:<skill>`, and clots shows only
 * `<skill>`, so the name is the same for all bots and never shows.
 */
const PLUGIN_NAME = "bot";

const OWN_PREFIX = `${PLUGIN_NAME}:`;

/** Claude Code puts the plugin name before the description of each plugin skill. */
const OWN_DESCRIPTION_PREFIX = `(${PLUGIN_NAME}) `;

/** Matches the source that Claude Code puts after a skill's description, such as " (user)". The picker shows the description only. */
const SOURCE_SUFFIX = / \((?:user|project|claude\.ai sync)\)$/;

/**
 * Finds the plugin folder in a bot's notes directory. It holds the skills that only this bot loads. A
 * clone uses the folder of the bot that it mirrors, so it always has the same skills.
 */
const pluginFolder = (bot: StoredBot) =>
  join(bot.parentDirectory ?? bot.workingDirectory, "plugin");

/** Finds the folder that holds one folder per skill of the bot. */
const skillsFolder = (bot: StoredBot) => join(pluginFolder(bot), "skills");

/** Matches a skill name that is also a safe folder name, such as `launch-posts`: no path parts, no spaces, no capitals. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Claude Code takes skill names of up to 64 characters. */
const MAX_SKILL_NAME = 64;

const isSkillName = (name: string) => name.length <= MAX_SKILL_NAME && SKILL_NAME.test(name);

/** Splits a SKILL.md into its frontmatter and its body. A file without frontmatter is all body. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[^\S\n]*(?:\r?\n|$)([\s\S]*)$/;

/** Makes a folder name from a name, such as `launch-posts` from "Launch posts". */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SKILL_NAME) || "skill";

/** Keeps the frontmatter fields other than the name and the description, such as `allowed-tools`, with their indented lines. */
const otherFields = (frontmatter: string) => {
  const kept: Array<string> = [];
  let skipping = false;

  for (const line of frontmatter.split("\n")) {
    if (!/^\s/.test(line)) {
      skipping = /^(?:name|description)\s*:/.test(line);
    }

    if (!skipping && line.trim() !== "") {
      kept.push(line);
    }
  }

  return kept;
};

/** Writes the plugin manifest when the bot has none yet, such as when the bot wrote its first skill itself. Claude Code names the skills after it. */
export const ensurePluginManifest = (bot: StoredBot) => {
  const folder = join(pluginFolder(bot), ".claude-plugin");

  if (existsSync(join(folder, "plugin.json"))) {
    return;
  }

  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "plugin.json"), `${JSON.stringify({ name: PLUGIN_NAME }, null, 2)}\n`);
};

/** Writes one SKILL.md, and the plugin manifest when the bot has none yet. A field that the bot added to the frontmatter stays. */
const writeSkill = (bot: StoredBot, skill: BotSkill) => {
  ensurePluginManifest(bot);

  const file = join(skillsFolder(bot), skill.name, "SKILL.md");
  const previous = existsSync(file)
    ? (FRONTMATTER.exec(readFileSync(file, "utf8"))?.[1] ?? "")
    : "";
  mkdirSync(join(skillsFolder(bot), skill.name), { recursive: true });

  // A JSON string is valid YAML, so a description with a colon stays one value.
  const fields = [
    `name: ${skill.name}`,
    `description: ${JSON.stringify(skill.description.trim())}`,
    ...otherFields(previous),
  ];
  writeFileSync(file, `---\n${fields.join("\n")}\n---\n\n${skill.body.trim()}\n`);
};

/** Writes the skills of a new bot as a Claude Code plugin in its notes directory. After this the skills belong to the bot: it and the operator edit them. */
export const writeBotSkills = (bot: StoredBot, skills: ReadonlyArray<BotSkill>) => {
  for (const skill of skills) {
    writeSkill(bot, { ...skill, name: slug(skill.name) });
  }
};

/** Lists the skill folders of the bot by name. A folder without a SKILL.md is not a skill. */
const skillFolders = (bot: StoredBot) => {
  const folder = skillsFolder(bot);

  if (!existsSync(folder)) {
    return [];
  }

  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "SKILL.md")))
    .map((entry) => ({ name: entry.name, file: join(folder, entry.name, "SKILL.md") }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** Reads the bot's own skills from their files. The folder name is the skill's name, as Claude Code sees it. */
export const readBotSkills = (bot: StoredBot): Array<BotSkill> =>
  skillFolders(bot).map(({ name, file }) => {
    const text = readFileSync(file, "utf8");
    const parts = FRONTMATTER.exec(text);

    if (parts === null) {
      return { name, description: "", body: text.trim() };
    }

    // The bot can write any YAML. A file that does not parse still shows its body.
    let fields: unknown = null;
    try {
      fields = Bun.YAML.parse(parts[1]!);
    } catch {}

    const description =
      typeof fields === "object" &&
      fields !== null &&
      "description" in fields &&
      typeof fields.description === "string"
        ? fields.description
        : "";

    return { name, description, body: parts[2]!.trim() };
  });

/**
 * Adds or changes one of the bot's own skills. With `previousName`, the skill had that name, and a new
 * name moves its folder, with any other files in it. Returns why the save failed, or nothing.
 */
export const saveBotSkill = (
  bot: StoredBot,
  skill: BotSkill,
  previousName?: string,
): InvalidSkill["reason"] | undefined => {
  if (!isSkillName(skill.name) || (previousName !== undefined && !isSkillName(previousName))) {
    return "name";
  }

  const target = join(skillsFolder(bot), skill.name);

  if (previousName === undefined && existsSync(target)) {
    return "taken";
  }

  if (previousName !== undefined && previousName !== skill.name) {
    const source = join(skillsFolder(bot), previousName);

    if (!existsSync(source)) {
      return "missing";
    }

    if (existsSync(target)) {
      return "taken";
    }

    renameSync(source, target);
  }

  writeSkill(bot, skill);
};

/** Deletes one of the bot's own skills with its folder. Returns why the delete failed, or nothing. */
export const deleteBotSkill = (
  bot: StoredBot,
  name: string,
): InvalidSkill["reason"] | undefined => {
  if (!isSkillName(name)) {
    return "name";
  }

  const folder = join(skillsFolder(bot), name);

  if (!existsSync(folder)) {
    return "missing";
  }

  rmSync(folder, { recursive: true });
};

/** Sums up the bot's skill files, so a change by anyone, such as the bot itself, shows as a new value. */
export const botSkillsSignature = (bot: StoredBot) =>
  skillFolders(bot)
    .map(({ name, file }) => {
      const { mtimeMs, size } = statSync(file);

      return `${name}:${mtimeMs}:${size}`;
    })
    .join("\n");

/** Lists the plugin of a bot for Claude Code, or none when the bot has no skills of its own. Other bots never get it. */
export const botPlugins = (bot: StoredBot) => {
  const folder = pluginFolder(bot);

  return existsSync(folder) ? [{ type: "local" as const, path: folder }] : [];
};

/**
 * Shows the bot's own skills by their bare names, such as `launch-posts` for `bot:launch-posts`. An own
 * skill wins over another skill with the same name, such as one in ~/.claude, so that one stays out.
 * Such an own skill is marked, so the details pane can say so. Each description loses the source tag that Claude Code adds.
 */
export const showOwnSkills = <
  Skill extends { readonly name: string; readonly description: string },
>(
  skills: ReadonlyArray<Skill>,
) => {
  const own = new Set(
    skills
      .filter((skill) => skill.name.startsWith(OWN_PREFIX))
      .map((skill) => skill.name.slice(OWN_PREFIX.length)),
  );
  const replaced = new Set(
    skills.filter((skill) => own.has(skill.name)).map((skill) => skill.name),
  );

  return skills.flatMap((skill): Array<Skill & { readonly replaces?: boolean }> => {
    if (!skill.name.startsWith(OWN_PREFIX)) {
      return own.has(skill.name)
        ? []
        : [{ ...skill, description: skill.description.replace(SOURCE_SUFFIX, "") }];
    }

    const description = skill.description.startsWith(OWN_DESCRIPTION_PREFIX)
      ? skill.description.slice(OWN_DESCRIPTION_PREFIX.length)
      : skill.description;

    const name = skill.name.slice(OWN_PREFIX.length);

    return [{ ...skill, name, description, ...(replaced.has(name) ? { replaces: true } : {}) }];
  });
};

/** Finds a `/skill` reference: it starts a word, and its name ends as in the composer's chips. */
const SKILL_REFERENCE = /(^|\s)\/([a-zA-Z0-9](?:[\w:.-]*\w)?)/g;

/**
 * Writes each `/skill` of the bot's own skills as `/bot:skill`, the name Claude Code knows. The thread
 * keeps the bare name that the operator sees, and only the prompt gets the full one.
 */
export const toOwnSkills = (bot: StoredBot, text: string) => {
  const folder = skillsFolder(bot);

  if (!existsSync(folder)) {
    return text;
  }

  const own = new Set(readdirSync(folder));

  return text.replace(SKILL_REFERENCE, (reference, before: string, name: string) =>
    own.has(name) ? `${before}/${OWN_PREFIX}${name}` : reference,
  );
};

/** Tells a bot with skills of its own to prefer them, because the model sees both skills of a shared name. */
export const OWN_SKILLS_NOTE = `Your own skills are the ${OWN_PREFIX}* skills. When one has the same name as another skill, use your own.`;
