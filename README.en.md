# Ibra X

[🇮🇩 Bahasa Indonesia](README.md) · 🇬🇧 English

[![npm version](https://img.shields.io/npm/v/ibra-x.svg)](https://www.npmjs.com/package/ibra-x)
[![license](https://img.shields.io/npm/l/ibra-x.svg)](LICENSE)
[![node](https://img.shields.io/node/v/ibra-x.svg)](https://nodejs.org)
[![ci](https://github.com/IbraDecode/ibra-x/actions/workflows/ci.yml/badge.svg)](https://github.com/IbraDecode/ibra-x/actions/workflows/ci.yml)

> An autonomous agent for WhatsApp — it reads, remembers, understands, and acts on your WhatsApp traffic. Open source, dead-simple install, built-in support for many LLM providers, with a Skills API & SDK.

`ibra-x` is a self-hosted WhatsApp agent platform. It links one or more WhatsApp numbers via [Baileys](https://github.com/WhiskeySockets/Baileys), then runs an autonomous agent loop: observes chats, remembers context, calls *skills* (tools), and replies under strict permissions.

**Status: `0.16.0`.** Published on npm as [`ibra-x`](https://www.npmjs.com/package/ibra-x). Active development on the `dev` branch.

---

## Why Ibra X?

- **One agent for your whole WhatsApp traffic.** Not a keyword bot — an agent that observes, remembers, and acts.
- **Multi-number with roles.** One number to *read* (`observer`), one to *reply* (`assistant`), or `hybrid`. Memory is shared across numbers.
- **Many LLM providers, connected directly.** OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, DeepSeek, xAI, local Ollama, and any OpenAI-compatible endpoint — no heavy SDK layers.
- **Skills API & SDK.** Write your own capabilities in TypeScript, or plug in an **MCP** server as a tool source.
- **Dead-simple install.** No build step when self-hosting. `npx ibra-x init`.
- **Secure by design.** Allowlist, per-account roles, risk tiers, approval for high-impact actions, untrusted-content isolation, rate limits, quiet hours.

---

## Quick Start

**Without cloning (npm):**

```bash
npx ibra-x init     # wizard: pick a provider, paste API key, link a WhatsApp number
npx ibra-x start    # run the agent + dashboard (http://127.0.0.1:8787)
```

**From source:**

```bash
git clone https://github.com/IbraDecode/ibra-x.git
cd ibra-x
npm install
npm run init
npm run start
```

Or with Docker: `docker compose up -d`.

---

## Core Concepts

| Concept | Meaning |
|---|---|
| **Account** | One WhatsApp number (a Baileys session) with a **role**: `observer`, `assistant`, or `hybrid`. |
| **Agent** | The decision loop: model + skills + memory + budget + permissions. |
| **Skill** | A plugin exposing tools (and prompts/hooks/jobs). Authored with `ibra-x/sdk`. |
| **Provider** | LLM adapter. All OpenAI-compatible providers run on one engine. |
| **Memory** | Long-term memory per contact/chat (SQLite + FTS5) plus session summaries. |
| **Policy** | Permission rules: who may trigger the agent, which actions need approval. |

---

## Built-in Skills

| Skill | What it does |
|---|---|
| `core-memory` | Long-term memory: remember/search/forget facts (shared across numbers). |
| `whatsapp` | 23 WhatsApp tools (send text/media, voice notes, reactions, edit/delete, presence, history, group admin, polls, location, number check, profile, block). |
| `subagents` | Delegate to context-isolated subagents. |
| `autoreply` | Rule-based auto-replies (keyword/regex) evaluated **before** the LLM. |
| `handoff` | Human handoff — pauses auto-replies per chat (with auto-escalation). |
| `notes` | Lightweight notes (add/search/list/delete). |
| `calendar` | Events + `.ics` calendar invites sent as WhatsApp documents. |
| `reminders` | Time-based reminders delivered automatically (job). |
| `scheduler` | Scheduled messages (job). |
| `digest` | Daily chat digest, summarized by a subagent (job). |
| `web-fetch` | Fetch a URL's text (with SSRF guard). |
| `web-search` | Web search (Brave/Tavily/Serper). |

## WhatsApp Capabilities

| Tool | Risk | Function |
|---|---|---|
| `wa_send_message` | medium | Send a text message |
| `wa_send_media` | medium | Send image/video/audio/document |
| `wa_send_voice` | medium | Reply with a voice note (TTS) |
| `wa_react` | low | Add/remove an emoji reaction |
| `wa_edit_message` | medium | Edit a sent message |
| `wa_delete_message` | **high** | Delete a message (needs approval) |
| `wa_mark_read` | low | Mark as read |
| `wa_get_history` | low | Fetch chat history |
| `wa_set_presence` | low | Typing/available indicator |
| `wa_list_chats` | low | List known chats |
| `wa_group_info` | low | Group info & participants |
| `wa_check_number` | low | Check if numbers exist on WhatsApp |
| `wa_group_create` | medium | Create a group |
| `wa_group_add` | medium | Add participants |
| `wa_group_remove` | **high** | Remove participants (needs approval) |
| `wa_group_promote` | medium | Promote to admin |
| `wa_group_demote` | **high** | Demote admin (needs approval) |
| `wa_group_invite` | low | Group invite code |
| `wa_group_setting` | medium | Group settings (announcement/locked) |
| `wa_send_location` | medium | Send a location |
| `wa_send_poll` | medium | Send a poll |
| `wa_profile_picture` | low | Profile picture URL |
| `wa_block` | **high** | Block/unblock a contact (needs approval) |

## Media Understanding

Incoming media is downloaded to `<dataDir>/media/` automatically:
- `IBRA_TRANSCRIBE=true` — auto-transcribe voice messages;
- `IBRA_DESCRIBE_IMAGES=true` — auto-describe images (needs a multimodal model);
- `IBRA_SPEAK=true` — enable `wa_send_voice` to **reply with a voice note** (TTS).

## Persistence & Privacy

Memory lives in a single SQLite DB (FTS5) and is **shared across numbers** — a fact learned by the `observer` number is available to the `assistant`. Each fact keeps **provenance** (which account, when) and duplicates are merged.

```bash
ibrax memory search "<query>"
ibrax memory export backup.json
ibrax memory import backup.json
ibrax memory verify
```

## Security & Limits

- **Sender allowlist** (`IBRA_ALLOWLIST`; empty = owner-only).
- **Graduated autonomy** — `readonly` → `suggest` → `auto` → `autonomous`.
- **Per-tool risk** — `low`/`medium`/`high`; `high` always needs approval.
- **Rate limits** — `IBRA_RATE_PER_SENDER`, `IBRA_RATE_PER_CHAT`.
- **Quiet hours** — `IBRA_QUIET_HOURS` (e.g. `22:00-07:00`) to hold auto-replies.
- **Channel isolation** — message content is treated as data, not instructions.

## Skills & MCP

Beyond local skills (`skills/`) and npm packages (`ibra-skill-*`), Ibra X can use an **MCP** server as a tool source:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/docs"] }
  }
}
```

MCP tools appear as skills with an `<id>__` prefix.

## Subagents

The agent can delegate self-contained tasks to **context-isolated subagents** via `spawn_subagent`. Only the final summary returns, keeping the main context small. Nesting depth is capped by `maxSubagentDepth` (default 1).

## Outbound Webhooks

Send events to other systems (n8n, Slack, CRM) via `config.webhooks`:

```json
{
  "webhooks": [
    { "url": "https://n8n.example/webhook/ibra", "events": ["inbound.message", "agent.finished"], "secret": "secret" }
  ]
}
```

JSON payload: `{ event, at, data }`. With a `secret`, the `x-ibra-signature` header carries an HMAC-SHA256 of the body. Failed deliveries are retried.

## Dashboard

After `ibrax start`, open **http://127.0.0.1:8787** — a single-page dashboard (no build step) showing status, accounts, skills/tools, an agent tester, memory search, and a live event stream (SSE). If `IBRA_API_TOKEN` is set, open with `?token=<token>`.

## Documentation

- 🌐 Docs site: https://ibradecode.github.io/ibra-x/
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture and design decisions
- [`docs/API.md`](docs/API.md) — SDK reference (skills, tools, hooks, jobs)
- [`docs/SKILLS.md`](docs/SKILLS.md) — authoring skills & using MCP
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow & branch strategy

## Branches

- `main` — stable, releases.
- `dev` — integration, active development. **PRs target `dev`.**

## License

MIT © IbraDecode
