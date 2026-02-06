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

Restart your Claude Code session to load the MCP server.

### Optional: Supabase persistence

To persist checkpoints across sessions and enable the evolution system, create a [Supabase](https://supabase.com) project and add environment variables:

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

Then run the schema in your Supabase SQL Editor:

```sql
-- See supabase/schema.sql for the full schema
```

Without Supabase, the server works in local-only mode (checkpoints reset each session).

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
                      ↓
               Supabase (optional)
               - checkpoints
               - interview_metadata
               - checkpoint_scores
               - interview_patterns
```

- **Session state** is in-memory (one session at a time)
- **Checkpoints** accumulate per category across sessions
- **Scoring** uses Bayesian smoothed decision rates + usage frequency
- **Privacy**: no conversation content leaves your machine

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
