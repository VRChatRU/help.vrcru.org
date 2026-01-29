# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Static Site Generator (SSG) that converts Discord forum threads from VRChatRU's help channel into static HTML pages. The bot monitors a specific Discord forum channel and publishes threads as HTML pages when authorized users react with 🌐 emoji. The entire project was created 99% using Codex (as noted in README).

## Commands

### Development

```bash
# Install dependencies
bun install

# Run the bot
bun run app

# Force regenerate all published pages
bun run app -- --rebuild
```

### Testing

No automated test suite exists. Test by:
1. Running the bot in development
2. Adding/removing publish reactions (🌐) to forum threads
3. Checking generated output in the `OUTPUT_DIR` (default: `www/`)

## Architecture

### Core Application Flow

1. **Bot Initialization** (`run()` function at app.ts:1377)
   - Loads templates from `templates/` directory
   - Connects to Discord with required intents (Guilds, GuildMembers, Messages, Reactions)
   - Rebuilds index page from local metadata on startup
   - Optionally force-rebuilds all pages with `--rebuild` flag

2. **Event-Driven Publishing** (app.ts:1573-1623)
   - Listens to `messageReactionAdd` and `messageReactionRemove` events
   - Only processes reactions on starter messages (first message in thread)
   - Validates reactor has `PUBLISHER_ROLE_ID` via `memberHasAnyRole()`
   - Queues thread generation/removal through serial queue to prevent race conditions

3. **Thread Publishing Logic** (`isPublishableThread()` at app.ts:371)
   - Fetches starter message of thread
   - Checks for presence of `PUBLISH_EMOJI` (default: 🌐) reaction
   - Verifies at least one non-bot reactor has publisher role
   - Returns boolean determining whether to generate or remove page

4. **Page Generation Pipeline** (`buildThreadPage()` at app.ts:958)
   - Fetches all messages using pagination (`fetchAllMessages()`)
   - Downloads and localizes all assets (avatars, emojis, attachments, embeds)
   - Processes markdown with `markdown-it`, applying custom rules for images and links
   - Groups messages by author using 10-minute window (`GROUP_WINDOW_MS`)
   - Renders HTML using template variable substitution
   - Generates metadata JSON for index rebuilding

5. **Asset Management** (app.ts:461-481, 677-774)
   - Downloads assets on-demand with URL-based deduplication via `downloaded` Map
   - Stores in `OUTPUT_DIR/assets/` organized by type:
     - `assets/<threadId>/*` - thread-specific attachments/images
     - `assets/avatars/*` - user avatars
     - `assets/emojis/*` - custom Discord emojis
     - `assets/roles/*` - role icons
     - `assets/tags/*` - forum tag icons
   - Rewrites Discord CDN URLs to local paths
   - Handles animated emojis (GIF) vs static (PNG)

6. **Message Grouping** (app.ts:1099-1117)
   - Groups consecutive messages from same author within 10-minute window
   - Uses `isSameAuthor()` and timestamp delta checks
   - Each group renders as single `<article class="group">` with shared avatar/header

7. **Index Page Management** (`buildIndexPage()` at app.ts:1197)
   - Sorts threads by creation date (newest first)
   - Reads metadata from `threads/<threadId>/meta.json` files
   - Debounces index rebuilds with 200ms timer (`scheduleIndexRebuild()`)

### Template System

Templates use simple `{{variable}}` substitution (app.ts:240):

- `templates/index.html` - Main listing page
- `templates/thread.html` - Individual thread page
- `templates/style.css` - Copied to `assets/style.css` on each generation

Available template variables documented in README.md lines 66-78.

### Special Features

**Answer Marking** (app.ts:876-901)
- Messages with ✅ reaction from publisher are marked with "Ответ" badge
- Uses `isAnswerMessage()` to validate reactor permissions

**Reply Threading** (app.ts:1274-1315)
- Renders reply context with quoted text (max 80 chars)
- Links to referenced message using `#m-{messageId}` anchor

**Mention Handling** (app.ts:609-666)
- Replaces Discord `<@userid>` with styled HTML spans
- Uses token-based system to survive markdown processing
- Preserves member display colors

**Custom Emoji Processing** (app.ts:521-550)
- Converts `<:name:id>` and `<a:name:id>` syntax
- Downloads from Discord CDN
- Renders as inline images with 30px sizing

**GIF Link Normalization** (app.ts:157-165)
- Detects standalone GIF URLs in text
- Converts to markdown image syntax for rendering

**SEO Optimization**
- Generates meta description from thread excerpt (app.ts:1144)
- OpenGraph tags for title, description, and first image
- Canonical URLs when `BASE_URL` is configured
- JSON-LD structured data (template variable available)

### Configuration (.env)

All settings loaded via `getConfig()` (app.ts:102-120):

- `BOT_TOKEN` - Discord bot token (required)
- `GUILD_ID` - Discord server ID (required)
- `FORUM_CHANNEL_ID` - Forum channel to monitor (required)
- `PUBLISHER_ROLE_ID` - Comma-separated role IDs that can publish (required)
- `PUBLISH_EMOJI` - Emoji for publishing (default: 🌐, can be emoji ID for custom)
- `ANSWER_EMOJI` - Emoji for marking answers (default: ✅)
- `OUTPUT_DIR` - Output directory for generated site (default: from env)
- `BASE_URL` - Base URL for canonical links (optional)
- `SITE_TITLE` - Site title for templates (required)
- `SITE_DESCRIPTION` - Site description for SEO (required)
- `LOG_CHANNEL_ID` - Channel for bot logs (optional)

### Error Handling

**Missing Starter Messages** (app.ts:349-361)
- Discord error code 10008 (Unknown Message) is expected for deleted threads
- Logged once per thread using `unknownStarterLogged` Set to prevent spam

**Serial Queue** (app.ts:1245-1251)
- All publish/unpublish operations run through `createSerialQueue()`
- Prevents concurrent modifications to same thread
- Ensures index rebuilds happen after page generation completes

**Asset Download Failures** (app.ts:477-479)
- Non-fatal: logs warning but continues generation
- Falls back to original Discord CDN URL if download fails

## Code Structure

- **app.ts:1-155** - Utility functions (HTML escaping, markdown stripping, filename sanitization)
- **app.ts:156-247** - Template and file system helpers
- **app.ts:248-333** - SEO meta tag builders
- **app.ts:334-423** - Thread publishing validation logic
- **app.ts:424-481** - Message fetching and asset management
- **app.ts:482-774** - Content processing (images, emojis, attachments, mentions)
- **app.ts:775-901** - Author profiles and answer detection
- **app.ts:902-1190** - Thread page rendering and HTML generation
- **app.ts:1191-1341** - Index page building and asset copying
- **app.ts:1342-1375** - Metadata persistence
- **app.ts:1376-1631** - Main bot event loop and Discord integration

## Important Notes

- The bot is read-only and never sends messages (only reads and reacts to reactions)
- Uses `Partials` for Message, Channel, Reaction, and User to handle uncached events
- Requires `Server Members` privileged intent to check publisher roles
- All HTML is generated server-side; no client-side JavaScript in output
- Markdown rendering disables raw HTML (`html: false` in markdown-it config)
- External links get `target="_blank" rel="noopener"` automatically
- Images are wrapped in clickable links to full resolution
- Bot sends status messages to `LOG_CHANNEL_ID` and DMs to reaction actors
