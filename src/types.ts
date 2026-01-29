export type EnvConfig = {
  BOT_TOKEN: string;
  GUILD_ID: string;
  FORUM_CHANNEL_ID: string;
  PUBLISHER_ROLE_IDS: string[];
  OUTPUT_DIR: string;
  BASE_URL?: string;
  PUBLISH_EMOJI: string;
  ANSWER_EMOJI: string;
  SITE_TITLE: string;
  SITE_DESCRIPTION: string;
  LOG_CHANNEL_ID?: string;
};

export type PageMeta = {
  threadId: string;
  title: string;
  createdAt: Date;
  excerpt: string;
  pageRelPath: string;
};

export type Templates = {
  index: string;
  thread: string;
};

export type AuthorProfile = {
  name: string;
  color: string;
  avatarRel: string | null;
  roleIconRel: string | null;
};

export type MentionInfo = {
  name: string;
  color: string;
};

export type AssetResult = {
  markdown: string;
  extraHtml: string[];
  imageRels: string[];
  mentionTokens: Map<string, string>;
};

export type RenderedMessage = {
  messageId: string;
  createdAt: Date;
  htmlContent: string;
  extraHtml: string[];
  reactionsHtml: string;
  isAnswer: boolean;
  replyHtml: string;
};

export type MessageGroup = {
  author: AuthorProfile;
  messages: RenderedMessage[];
};
