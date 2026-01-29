import type { EnvConfig } from './types';

export const TEMPLATES_DIR = "templates";
export const DEFAULT_AUTHOR_COLOR = "#8b949e";
export const GROUP_WINDOW_MS = 10 * 60 * 1000;

export function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function parseIdList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getConfig(): EnvConfig {
  const publisherRoleIds = parseIdList(requireEnv("PUBLISHER_ROLE_ID"));
  if (publisherRoleIds.length === 0) {
    throw new Error("Missing required env var: PUBLISHER_ROLE_ID");
  }
  return {
    BOT_TOKEN: requireEnv("BOT_TOKEN"),
    GUILD_ID: requireEnv("GUILD_ID"),
    FORUM_CHANNEL_ID: requireEnv("FORUM_CHANNEL_ID"),
    PUBLISHER_ROLE_IDS: publisherRoleIds,
    OUTPUT_DIR: requireEnv("OUTPUT_DIR"),
    BASE_URL: process.env.BASE_URL,
    PUBLISH_EMOJI: requireEnv("PUBLISH_EMOJI"),
    ANSWER_EMOJI: requireEnv("ANSWER_EMOJI"),
    SITE_TITLE: requireEnv("SITE_TITLE"),
    SITE_DESCRIPTION: requireEnv("SITE_DESCRIPTION"),
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
  };
}
