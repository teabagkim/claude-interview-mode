# claude-interview-mode

An MCP (Model Context Protocol) server that turns Claude into a structured interviewer. Claude leads the conversation, asks probing questions, and tracks decisions — building a reusable checkpoint system that improves over time.

## What it does

- **Claude drives the interview** — asks questions, proposes options, challenges assumptions
- **Tracks Q&As and decisions** — structured records with timestamps
- **Checkpoint system** — learns what topics matter per category and suggests them in future sessions
- **Evolution system** — Bayesian scoring ranks checkpoints by how often they lead to decisions
- **Privacy-first** — only metadata (categories, checkpoint names) goes to Supabase; actual conversation content stays local

## Install

```bash
npx claude-interview-mode
```

Or install globally:

```bash
npm install -g claude-interview-mode
```

## Setup with Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "interview-mode": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "claude-interview-mode"]
    }
  }
}
```

Restart your Claude Code session to load the MCP server. That's it — checkpoints persist automatically via a shared community database.

### Optional: Your own Supabase

By default, checkpoint data is stored in a shared community Supabase instance (metadata only, no conversation content). If you want your own private database, set environment variables:

```json
{
  "mcpServers": {
    "interview-mode": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "claude-interview-mode"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_ANON_KEY": "your-anon-key"
      }
    }
  }
}
```

Then run `supabase/schema.sql` in your Supabase SQL Editor to create the tables.

## Usage

Start an interview with Claude Code:

```
> Let's do an interview about my SaaS pricing strategy
```

Claude will use the `interview` prompt to lead the conversation. You can also invoke tools directly:

### Tools

| Tool | Description |
|------|-------------|
| `start_interview` | Begin a session with a topic and optional category |
| `record` | Record a Q&A exchange or decision, with optional checkpoint coverage |
| `get_context` | Get current session state with uncovered checkpoints and recommendations |
| `end_interview` | End session, get summary, and persist metadata |

### How checkpoints work

1. **First interview** in a category — no checkpoints, explore freely
2. Claude's **decisions** become checkpoints for future sessions
3. **Next interview** in the same category loads those checkpoints, sorted by effectiveness
4. The system **learns** which checkpoints consistently lead to decisions (Bayesian scoring)
5. Over time, the recommended interview path optimizes itself

## How it works

```
You ←→ Claude ←→ MCP Server (interview-mode)
                      ↓ read (anon key)
               Supabase (shared community DB)
                      ↑ write (Edge Function, validated)
```

- **Session state** is in-memory, supports concurrent sessions
- **Checkpoints** accumulate per category across sessions and users
- **Scoring** uses Bayesian smoothed decision rates + usage frequency
- **Security**: writes go through an Edge Function with validation; anon key is read-only
- **Privacy**: no conversation content leaves your machine — only metadata (category names, checkpoint names, counts)

## Development

```bash
git clone https://github.com/teabagkim/claude-interview-mode.git
cd claude-interview-mode
npm install
npm run build    # TypeScript → dist/index.js
npm run dev      # Watch mode
```

## License

MIT
