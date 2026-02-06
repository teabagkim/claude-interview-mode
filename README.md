# claude-interview-mode

An MCP server that turns Claude into a structured interviewer — and **gets smarter with every conversation**. Each interview feeds a shared evolution system where checkpoints are scored, ranked, and recommended based on real usage patterns across all users.

## The Evolution System

This isn't just an interview tool. It's a **collectively evolving knowledge system**.

Every time anyone runs an interview in a category (e.g., "saas-pricing"), the system learns:

```
Session 1:  You explore freely → decisions become new checkpoints
Session 2:  Checkpoints load → Claude prioritizes what matters
Session 5:  Bayesian scores stabilize → the interview path optimizes itself
Session 20: Community patterns emerge → everyone benefits from collective experience
```

### How evolution works

**1. Checkpoint Discovery** — When a decision is made during an interview, its topic is automatically registered as a new checkpoint. After just a few sessions, the system knows what topics matter for each category.

**2. Bayesian Scoring** — Each checkpoint tracks how often it's covered and how often it leads to a decision. The score uses Bayesian smoothing to handle sparse data:

```
decision_rate = (decisions + 0.6) / (times_covered + 2)
```

The prior (0.6/2 = 30% base rate) ensures new checkpoints start with a reasonable score. After ~5 sessions, real data dominates.

**3. Composite Ranking** — Checkpoints are ranked by a composite score combining decision-leading effectiveness (70%) and usage frequency (30%):

```
composite = decision_rate × 0.7 + normalized_usage × 0.3
```

High-scoring checkpoints are the ones that consistently lead to concrete decisions — not just topics that get discussed.

**4. Recommended Path** — The system computes an optimal interview path: checkpoints with `decision_rate > 0.2`, sorted by their average position in past sessions. This tells Claude not just *what* to ask, but *when* to ask it.

**5. Community Evolution** — All metadata flows to a shared database. When you interview about "api-design", you benefit from every other user who interviewed about "api-design" before you. The checkpoints, scores, and paths evolve collectively.

### What gets shared (and what doesn't)

| Shared (metadata only) | Never shared |
|------------------------|--------------|
| Category names (e.g., "saas-pricing") | Your actual questions and answers |
| Checkpoint names (e.g., "pricing-model") | Decision details and reasoning |
| Usage counts, scores, positions | Any personal or project-specific content |

## What it does

- **Claude drives the interview** — asks questions, proposes options with reasoning, challenges assumptions
- **Tracks Q&As and decisions** — structured records with timestamps
- **Evolving checkpoints** — learns what topics matter per category, ranked by Bayesian effectiveness scores
- **Recommended paths** — suggests the optimal order to explore topics based on past interview patterns
- **Concurrent sessions** — supports multiple interviews running in parallel
- **Privacy-first** — only anonymous metadata (categories, checkpoint names, counts) goes to the shared database

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

Restart your Claude Code session to load the MCP server. That's it — the evolution system starts working immediately via a shared community database.

### Optional: Your own Supabase

By default, checkpoint data is stored in a shared community Supabase instance. If you want your own private database:

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

Claude will lead the conversation. As the interview progresses:
- Each Q&A and decision is recorded with checkpoint coverage
- At the end, metadata is uploaded to evolve the system
- Next time anyone interviews in the same category, the improved checkpoints are loaded

### Tools

| Tool | Description |
|------|-------------|
| `start_interview` | Begin a session — loads scored checkpoints and recommended path |
| `record` | Record a Q&A or decision, with checkpoint coverage tracking |
| `get_context` | Review progress, see uncovered checkpoints ranked by score |
| `end_interview` | End session, upload metadata, evolve the checkpoint system |

## Architecture

```
You ←→ Claude ←→ MCP Server (interview-mode)
                      │
                      ├─ read (anon key, read-only)
                      │     └→ checkpoints, scores, patterns
                      │
                      └─ write (Edge Function, validated)
                            └→ metadata, checkpoint updates, score recalculation
                      │
               Supabase (shared community DB)
```

**4 database tables power the evolution:**

| Table | Purpose |
|-------|---------|
| `checkpoints` | Checkpoint dictionary per category (name, usage count, decision count) |
| `checkpoint_scores` | Bayesian scores per checkpoint (decision rate, avg position, samples) |
| `interview_patterns` | Coverage sequences per session (which checkpoints, in what order) |
| `interview_metadata` | Session summaries (category, counts, duration) |

**Security:**
- Anon key is read-only (SELECT only via RLS)
- All writes go through an Edge Function with input validation and spam defense
- Empty interviews, implausible rates, and oversized payloads are rejected

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
