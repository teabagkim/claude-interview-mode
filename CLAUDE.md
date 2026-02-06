# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Claude Interview Mode — an MCP server for Claude Code that turns Claude into a structured interviewer.
Claude leads conversations, asks probing questions, tracks decisions, and builds a checkpoint system that improves over time.
npm package: `claude-interview-mode` (runnable via `npx`)

## Stack

- TypeScript + Node.js (ES2022, ESM)
- `@modelcontextprotocol/sdk` (MCP protocol)
- `@supabase/supabase-js` (optional checkpoint persistence)
- `zod` (schema validation)

## Commands

```bash
npm run build        # TypeScript build (tsc) → dist/index.js
npm run dev          # Watch mode (tsc --watch)
```

Smoke test after build:
```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}' | node dist/index.js
```

## Architecture

Single-file MCP server (`src/index.ts`, ~790 lines). Session state is in-memory, checkpoint/metadata persistence via Supabase (optional).

### Core Design
- **Claude drives the conversation**, MCP server tracks state + manages checkpoints
- Per-session state: `entries` (Q&A pairs), `decisions`, `checkpoints` (live checklist), `coverageOrder` (sequence tracking)
- Supabase is optional — without env vars, runs in local-only mode (checkpoints reset each session)
- **Privacy**: only metadata (categories, checkpoint names, counts) goes to Supabase; conversation content stays local
- Supports concurrent sessions via `session_id` parameter; falls back to most recent active session if omitted

### MCP Tools
| Tool | Purpose |
|------|---------|
| `start_interview` | Begin session + load category checkpoints from Supabase (sorted by composite score) |
| `record` | Save Q&A or decision + mark `covered_checkpoints` + track coverage order |
| `get_context` | Return session state + uncovered checkpoints with score-based recommendations |
| `end_interview` | Close session + generate summary + upload metadata to Supabase |

### MCP Prompt
- `interview` — Activates interviewer persona with rules for one-question-at-a-time flow, checkpoint strategy guidance, and proactive behavior

### Evolution System (Phase 5)
Checkpoints improve across sessions via Bayesian scoring:
- **Scoring**: `bayesianDecisionRate(α=0.6, β=2)` smooths decision rates for low-sample checkpoints
- **Composite score**: `decisionRate × 0.7 + normalizedUsage × 0.3` — balances effectiveness with popularity
- **Recommended path**: checkpoints with `decisionRate ≥ 0.2`, sorted by average position in past interviews
- `uploadMetadata()` at session end upserts `checkpoints`, `checkpoint_scores`, and `interview_patterns` tables

### Supabase Tables (`supabase/schema.sql`)
| Table | Purpose |
|-------|---------|
| `checkpoints` | Category-scoped checkpoint dictionary (grows with usage). Tracks `usage_count` and `decision_count` |
| `interview_metadata` | Session-level stats (no personal content) |
| `checkpoint_scores` | Per-checkpoint Bayesian scores: `decision_rate`, `avg_position`, coverage/decision counts |
| `interview_patterns` | Per-session coverage sequences for pattern analysis |

All tables have RLS enabled with public read/insert/update policies (anon key).

### Environment Variables
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon public key

## MCP Registration

Register via `.mcp.json` (stdio transport, runs `node dist/index.js`).
`.claude/settings.local.json` mcpServers does **not** work — must use `.mcp.json`.

## CI/CD

GitHub Actions workflow (`.github/workflows/publish.yml`) publishes to npm on version tag push (`v*`).
Requires `NPM_TOKEN` secret in GitHub repository settings (under `NPM_TOKEN` environment).

## Dev Docs

Working documents: `dev/active/interview-mode-mcp/` (plan, context, tasks)

## Critical Notes

- MCP servers load **only at session start** — after code changes, rebuild + restart session
- `dist/index.js` includes shebang (`#!/usr/bin/env node`) for direct npx execution
- `package.json` `bin` field maps `claude-interview-mode` → `dist/index.js`
- `package.json` `files` field limits npm package to `dist/`, `README.md`, `LICENSE`
- Supabase `uploadMetadata()` must be `await`ed — fire-and-forget causes data loss on process exit
