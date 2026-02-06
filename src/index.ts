#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// --- Types ---

interface QAEntry {
  question: string;
  answer: string;
  timestamp: string;
}

interface Decision {
  topic: string;
  decision: string;
  reasoning?: string;
  timestamp: string;
}

interface Checkpoint {
  name: string;
  covered: boolean;
  score: number;
}

interface CoverageEvent {
  checkpointName: string;
  coveredAtEntry: number;
  ledToDecision: boolean;
  timestamp: string;
}

interface CheckpointScore {
  decisionRate: number;
  avgPosition: number;
}

interface InterviewSession {
  id: string;
  topic: string;
  category: string;
  startedAt: string;
  entries: QAEntry[];
  decisions: Decision[];
  checkpoints: Checkpoint[];
  coverageOrder: CoverageEvent[];
  status: "active" | "completed";
}

// --- Supabase ---

const DEFAULT_SUPABASE_URL = "https://wxbwktkgmdqzrpljmmvj.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4YndrdGtnbWRxenJwbGptbXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNTg0MDksImV4cCI6MjA4NTkzNDQwOX0.ZNYcZG85TyoZIxWMAW-r321V7rEG6FjZZaZ4q0ujZG8";
const EDGE_FUNCTION_URL = `${DEFAULT_SUPABASE_URL}/functions/v1/super-api`;

function getSupabaseUrl(): string {
  return process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
}

function getSupabaseKey(): string {
  return process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
}

function isUsingSharedSupabase(): boolean {
  return getSupabaseUrl() === DEFAULT_SUPABASE_URL;
}

let _supabaseClient: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabaseClient) {
    _supabaseClient = createClient(getSupabaseUrl(), getSupabaseKey());
  }
  return _supabaseClient;
}

// --- Normalization ---

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

// --- Scoring Helpers ---

function bayesianDecisionRate(decisions: number, covered: number): number {
  const PRIOR_ALPHA = 0.6;
  const PRIOR_BETA = 2;
  return (decisions + PRIOR_ALPHA) / (covered + PRIOR_BETA);
}

function compositeScore(
  decisionRate: number,
  usageCount: number,
  maxUsage: number
): number {
  const normalizedUsage = maxUsage > 0 ? usageCount / maxUsage : 0;
  return decisionRate * 0.7 + normalizedUsage * 0.3;
}

function computeRecommendedPath(
  scores: Map<string, CheckpointScore>
): string[] {
  return [...scores.entries()]
    .filter(([, s]) => s.decisionRate >= 0.2)
    .sort((a, b) => a[1].avgPosition - b[1].avgPosition)
    .map(([name]) => name);
}

// --- Supabase ---

async function loadCheckpointScores(
  category: string
): Promise<Map<string, CheckpointScore>> {
  const sb = getSupabase();

  const { data } = await sb
    .from("checkpoint_scores")
    .select("checkpoint_name, decision_rate, avg_position")
    .eq("category", category);

  const map = new Map<string, CheckpointScore>();
  for (const row of data ?? []) {
    map.set(row.checkpoint_name, {
      decisionRate: Number(row.decision_rate),
      avgPosition: Number(row.avg_position),
    });
  }
  return map;
}

async function loadCheckpoints(category: string): Promise<string[]> {
  const sb = getSupabase();

  const { data } = await sb
    .from("checkpoints")
    .select("name")
    .eq("category", category)
    .order("usage_count", { ascending: false });

  return data?.map((row) => row.name) ?? [];
}

// --- Upload: Edge Function (shared) or direct (private) ---

async function uploadViaEdgeFunction(
  session: InterviewSession
): Promise<void> {
  const covered = session.checkpoints
    .filter((cp) => cp.covered)
    .map((cp) => cp.name);

  const durationMs =
    new Date().getTime() - new Date(session.startedAt).getTime();

  const payload = {
    category: session.category,
    covered_checkpoints: covered,
    checkpoints_total: session.checkpoints.length,
    total_qas: session.entries.length,
    total_decisions: session.decisions.length,
    duration_seconds: Math.round(durationMs / 1000),
    coverage_order: session.coverageOrder.map((e) => ({
      checkpoint_name: e.checkpointName,
      led_to_decision: e.ledToDecision,
    })),
    decision_topics: session.decisions.map((d) => normalizeKey(d.topic)),
    known_checkpoint_names: session.checkpoints.map((cp) => cp.name),
  };

  const res = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSupabaseKey()}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(
      `[interview-mode] Edge Function error (${res.status}):`,
      body
    );
  } else {
    console.error("[interview-mode] Edge Function upload OK");
  }
}

async function uploadDirectToSupabase(
  session: InterviewSession
): Promise<void> {
  const sb = getSupabase();

  const covered = session.checkpoints
    .filter((cp) => cp.covered)
    .map((cp) => cp.name);

  const durationMs =
    new Date().getTime() - new Date(session.startedAt).getTime();

  // Upload session metadata (no personal content)
  const { error: metaError } = await sb.from("interview_metadata").insert({
    category: session.category,
    checkpoints_covered: covered,
    checkpoints_total: session.checkpoints.length,
    total_qas: session.entries.length,
    total_decisions: session.decisions.length,
    duration_seconds: Math.round(durationMs / 1000),
  });

  if (metaError) {
    console.error(
      "[interview-mode] interview_metadata insert error:",
      metaError
    );
  }

  // Build decision checkpoint set for quick lookup
  const decisionCpSet = new Set(
    session.coverageOrder
      .filter((e) => e.ledToDecision)
      .map((e) => e.checkpointName)
  );

  // Upsert checkpoints: increment usage_count + decision_count
  for (const cp of covered) {
    const ledToDecision = decisionCpSet.has(cp);
    const { data: existing } = await sb
      .from("checkpoints")
      .select("id, usage_count, decision_count")
      .eq("category", session.category)
      .eq("name", cp)
      .single();

    if (existing) {
      await sb
        .from("checkpoints")
        .update({
          usage_count: existing.usage_count + 1,
          decision_count: existing.decision_count + (ledToDecision ? 1 : 0),
        })
        .eq("id", existing.id);
    } else {
      await sb.from("checkpoints").insert({
        category: session.category,
        name: cp,
        usage_count: 1,
        decision_count: ledToDecision ? 1 : 0,
      });
    }
  }

  // Discover new checkpoints from decision topics
  const allKnown = new Set(session.checkpoints.map((cp) => cp.name));
  const decisionTopics = session.decisions.map((d) => d.topic);
  for (const topic of decisionTopics) {
    if (!allKnown.has(topic)) {
      const { data: exists } = await sb
        .from("checkpoints")
        .select("id")
        .eq("category", session.category)
        .eq("name", topic)
        .single();

      if (!exists) {
        await sb.from("checkpoints").insert({
          category: session.category,
          name: topic,
          usage_count: 1,
          decision_count: 1,
        });
      }
    }
  }

  // Insert interview pattern
  const { error: patternError } = await sb
    .from("interview_patterns")
    .insert({
      category: session.category,
      coverage_sequence: session.coverageOrder.map((e) => e.checkpointName),
      decision_checkpoints: session.coverageOrder
        .filter((e) => e.ledToDecision)
        .map((e) => e.checkpointName),
      total_qas: session.entries.length,
      total_decisions: session.decisions.length,
      total_checkpoints_available: session.checkpoints.length,
    });

  if (patternError) {
    console.error(
      "[interview-mode] interview_patterns insert error:",
      patternError
    );
  }

  // Upsert checkpoint_scores
  for (let i = 0; i < session.coverageOrder.length; i++) {
    const event = session.coverageOrder[i];
    const position = i + 1;

    const { data: existing } = await sb
      .from("checkpoint_scores")
      .select(
        "id, times_covered, times_led_to_decision, avg_position, position_samples"
      )
      .eq("category", session.category)
      .eq("checkpoint_name", event.checkpointName)
      .single();

    if (existing) {
      const newCovered = existing.times_covered + 1;
      const newDecisions =
        existing.times_led_to_decision + (event.ledToDecision ? 1 : 0);
      const newSamples = existing.position_samples + 1;
      const newAvgPos =
        (Number(existing.avg_position) * existing.position_samples + position) /
        newSamples;

      await sb
        .from("checkpoint_scores")
        .update({
          times_covered: newCovered,
          times_led_to_decision: newDecisions,
          decision_rate: bayesianDecisionRate(newDecisions, newCovered),
          avg_position: +newAvgPos.toFixed(2),
          position_samples: newSamples,
        })
        .eq("id", existing.id);
    } else {
      await sb.from("checkpoint_scores").insert({
        category: session.category,
        checkpoint_name: event.checkpointName,
        times_covered: 1,
        times_led_to_decision: event.ledToDecision ? 1 : 0,
        decision_rate: bayesianDecisionRate(event.ledToDecision ? 1 : 0, 1),
        avg_position: position,
        position_samples: 1,
      });
    }
  }
}

async function uploadMetadata(session: InterviewSession): Promise<void> {
  if (isUsingSharedSupabase()) {
    await uploadViaEdgeFunction(session);
  } else {
    await uploadDirectToSupabase(session);
  }
}

// --- State ---

const sessions = new Map<string, InterviewSession>();

function findSession(sessionId?: string): InterviewSession | null {
  if (sessionId) return sessions.get(sessionId) ?? null;
  // Fallback: most recently created active session
  let latest: InterviewSession | null = null;
  for (const s of sessions.values()) {
    if (s.status === "active") {
      if (!latest || s.startedAt > latest.startedAt) latest = s;
    }
  }
  return latest;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function now(): string {
  return new Date().toISOString();
}

// --- MCP Server ---

const server = new McpServer({
  name: "claude-interview-mode",
  version: "0.5.1",
});

// Tool: start_interview
server.tool(
  "start_interview",
  "Start a new interview session. Use this when beginning a conversational exploration of a topic, project, or decision.",
  {
    topic: z.string().describe("The topic or purpose of this interview"),
    category: z
      .string()
      .optional()
      .describe(
        "Category for checkpoint matching (e.g. 'service-planning', 'api-design'). Defaults to topic."
      ),
  },
  async ({ topic, category }) => {
    const cat = normalizeKey(category ?? topic);
    const [checkpointNames, scores] = await Promise.all([
      loadCheckpoints(cat),
      loadCheckpointScores(cat),
    ]);

    // Sort checkpoints by composite score
    const maxUsage = checkpointNames.length; // rough proxy
    const sortedCheckpoints = checkpointNames
      .map((name) => {
        const s = scores.get(name);
        const score = s
          ? compositeScore(s.decisionRate, 1, maxUsage)
          : 0;
        return { name, score };
      })
      .sort((a, b) => b.score - a.score);

    const id = generateId();
    const session: InterviewSession = {
      id,
      topic,
      category: cat,
      startedAt: now(),
      entries: [],
      decisions: [],
      checkpoints: sortedCheckpoints.map(({ name, score }) => ({
        name,
        covered: false,
        score,
      })),
      coverageOrder: [],
      status: "active",
    };

    sessions.set(id, session);

    const hasCheckpoints = sortedCheckpoints.length > 0;
    const recommendedPath = computeRecommendedPath(scores);
    const highValue = [...scores.entries()]
      .filter(([, s]) => s.decisionRate > 0.3)
      .sort((a, b) => b[1].decisionRate - a[1].decisionRate)
      .slice(0, 5)
      .map(([name, s]) => ({ name, decision_rate: +s.decisionRate.toFixed(2) }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              sessionId: id,
              topic,
              category: cat,
              checkpoints: hasCheckpoints
                ? sortedCheckpoints.map((c) => c.name)
                : "(no prior checkpoints — this is a new category)",
              ...(recommendedPath.length > 0 && { recommended_path: recommendedPath }),
              ...(highValue.length > 0 && { high_value_checkpoints: highValue }),
              message: hasCheckpoints
                ? `Interview started with ${sortedCheckpoints.length} checkpoints (sorted by effectiveness). ${recommendedPath.length > 0 ? `Recommended path based on ${scores.size} scored checkpoints.` : ""}`
                : "Interview started. No prior checkpoints for this category — explore freely and discover what matters.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: record
server.tool(
  "record",
  "Record a Q&A exchange or a decision made during the interview. Call this after each meaningful exchange to maintain context.",
  {
    type: z
      .enum(["qa", "decision"])
      .describe(
        "Type of record: 'qa' for question-answer, 'decision' for a decision made"
      ),
    question: z
      .string()
      .optional()
      .describe("The question asked (for qa type)"),
    answer: z
      .string()
      .optional()
      .describe("The answer received (for qa type)"),
    topic: z
      .string()
      .optional()
      .describe("The topic of the decision (for decision type)"),
    decision: z
      .string()
      .optional()
      .describe("The decision made (for decision type)"),
    reasoning: z
      .string()
      .optional()
      .describe("Why this decision was made (for decision type)"),
    covered_checkpoints: z
      .array(z.string())
      .optional()
      .describe(
        "Checkpoint names that this Q&A or decision covers. Match against the checkpoints loaded at session start."
      ),
    session_id: z
      .string()
      .optional()
      .describe(
        "Session ID to record into. If omitted, uses the most recent active session."
      ),
  },
  async ({
    type,
    question,
    answer,
    topic,
    decision,
    reasoning,
    covered_checkpoints,
    session_id,
  }) => {
    const session = findSession(session_id);
    if (!session) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No active interview session. Use start_interview first.",
          },
        ],
        isError: true,
      };
    }

    // Normalize covered checkpoint names
    const normalizedCovered = covered_checkpoints?.map(normalizeKey);

    // Mark covered checkpoints + track coverage order
    const isDecision = type === "decision";
    if (normalizedCovered?.length) {
      const entryIndex = session.entries.length + session.decisions.length;
      for (const cpName of normalizedCovered) {
        const cp = session.checkpoints.find(
          (c) => c.name === cpName
        );
        if (cp && !cp.covered) {
          cp.covered = true;
          session.coverageOrder.push({
            checkpointName: cp.name,
            coveredAtEntry: entryIndex,
            ledToDecision: isDecision,
            timestamp: now(),
          });
        }
        // Retroactively mark ledToDecision for previously covered checkpoints
        if (cp && isDecision) {
          const existing = session.coverageOrder.find(
            (e) => e.checkpointName === cp.name
          );
          if (existing) existing.ledToDecision = true;
        }
      }
    }

    // Helper: get next recommended uncovered checkpoint by score
    const getNextRecommended = () => {
      const uncov = session.checkpoints
        .filter((c) => !c.covered)
        .sort((a, b) => b.score - a.score);
      return uncov.length > 0 ? uncov[0].name : null;
    };

    if (type === "qa") {
      if (!question || !answer) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Both question and answer are required for qa type.",
            },
          ],
          isError: true,
        };
      }
      session.entries.push({ question, answer, timestamp: now() });

      const uncovered = session.checkpoints.filter((c) => !c.covered);
      const nextRec = getNextRecommended();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                recorded: `Q&A #${session.entries.length}`,
                totals: {
                  qas: session.entries.length,
                  decisions: session.decisions.length,
                },
                checkpoints: {
                  covered: session.checkpoints.filter((c) => c.covered).length,
                  remaining: uncovered.length,
                  uncovered_items:
                    uncovered.length > 0
                      ? uncovered.map((c) => c.name)
                      : "all covered",
                  ...(nextRec && { next_recommended: nextRec }),
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (type === "decision") {
      if (!topic || !decision) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Both topic and decision are required for decision type.",
            },
          ],
          isError: true,
        };
      }
      const normalizedTopic = normalizeKey(topic);
      session.decisions.push({ topic: normalizedTopic, decision, reasoning, timestamp: now() });

      const uncovered = session.checkpoints.filter((c) => !c.covered);
      const nextRec = getNextRecommended();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                recorded: `Decision #${session.decisions.length}: "${topic}" → "${decision}"`,
                totals: {
                  qas: session.entries.length,
                  decisions: session.decisions.length,
                },
                checkpoints: {
                  covered: session.checkpoints.filter((c) => c.covered).length,
                  remaining: uncovered.length,
                  uncovered_items:
                    uncovered.length > 0
                      ? uncovered.map((c) => c.name)
                      : "all covered",
                  ...(nextRec && { next_recommended: nextRec }),
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: "Invalid type." }],
      isError: true,
    };
  }
);

// Tool: get_context
server.tool(
  "get_context",
  "Get the full context of the current interview session. Use this to review what has been discussed so far before asking the next question.",
  {
    session_id: z
      .string()
      .optional()
      .describe("Session ID. If omitted, uses the most recent active session."),
  },
  async ({ session_id }) => {
    const session = findSession(session_id);
    if (!session) {
      return {
        content: [
          { type: "text" as const, text: "No active interview session." },
        ],
        isError: true,
      };
    }

    const coveredCps = session.checkpoints.filter((c) => c.covered);
    const uncoveredCps = session.checkpoints
      .filter((c) => !c.covered)
      .sort((a, b) => b.score - a.score);

    const recommendedNext = uncoveredCps
      .slice(0, 3)
      .map((c) => ({ name: c.name, score: +c.score.toFixed(2) }));

    const summary = {
      sessionId: session.id,
      topic: session.topic,
      category: session.category,
      startedAt: session.startedAt,
      status: session.status,
      totals: {
        qas: session.entries.length,
        decisions: session.decisions.length,
      },
      checkpoints: {
        total: session.checkpoints.length,
        covered: coveredCps.map((c) => c.name),
        uncovered: uncoveredCps.map((c) => ({
          name: c.name,
          score: +c.score.toFixed(2),
        })),
        ...(recommendedNext.length > 0 && { recommended_next: recommendedNext }),
      },
      coverage_order_so_far: session.coverageOrder.map((e) => e.checkpointName),
      entries: session.entries,
      decisions: session.decisions,
    };

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(summary, null, 2) },
      ],
    };
  }
);

// Tool: end_interview
server.tool(
  "end_interview",
  "End the current interview session and get a structured summary of all Q&As and decisions. Use this when enough information has been gathered.",
  {
    session_id: z
      .string()
      .optional()
      .describe("Session ID to end. If omitted, uses the most recent active session."),
  },
  async ({ session_id }) => {
    const session = findSession(session_id);
    if (!session) {
      return {
        content: [
          { type: "text" as const, text: "No active interview session." },
        ],
        isError: true,
      };
    }

    session.status = "completed";

    // Upload metadata to Supabase (best-effort, awaited to prevent process exit race)
    try {
      await uploadMetadata(session);
    } catch (err) {
      console.error("[interview-mode] Supabase upload failed:", err);
    }

    const coveredCps = session.checkpoints.filter((c) => c.covered);
    const uncoveredCps = session.checkpoints.filter((c) => !c.covered);

    const summary = {
      sessionId: session.id,
      topic: session.topic,
      category: session.category,
      duration: {
        start: session.startedAt,
        end: now(),
      },
      entries: session.entries,
      decisions: session.decisions,
      checkpoints: {
        total: session.checkpoints.length,
        covered: coveredCps.map((c) => c.name),
        uncovered: uncoveredCps.map((c) => c.name),
        newFromDecisions: session.decisions
          .map((d) => d.topic)
          .filter(
            (t) => !session.checkpoints.some((cp) => cp.name === t)
          ),
      },
      stats: {
        totalQAs: session.entries.length,
        totalDecisions: session.decisions.length,
        checkpointCoverage:
          session.checkpoints.length > 0
            ? `${coveredCps.length}/${session.checkpoints.length}`
            : "N/A (new category)",
      },
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }
);

// Prompt: interview
server.prompt(
  "interview",
  "Activate interview mode - Claude will ask questions one at a time to explore a topic conversationally.",
  {
    topic: z
      .string()
      .optional()
      .describe("Optional starting topic for the interview"),
  },
  ({ topic }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are now in INTERVIEW MODE.

## Rules
1. Ask ONE question at a time. Never ask multiple questions in a single message.
2. Wait for the user's answer before asking the next question.
3. Start broad, then go deeper based on answers.
4. After each meaningful exchange, use the \`record\` tool to save the Q&A pair.
5. When recording, include \`covered_checkpoints\` to mark which checkpoints this exchange addresses.
6. When a decision is made (explicitly or implicitly), record it with the \`record\` tool as a decision.
7. Periodically use \`get_context\` to review what's been discussed and check remaining uncovered checkpoints.
8. When you have enough information to take action, do it — create files, edit configs, write code, whatever is needed.
9. Use \`end_interview\` when the conversation naturally concludes.

## Interviewer Behavior
- **Be proactive**: Don't just list options — share your opinion with reasoning, then ask if the user agrees or has a different view.
- **Be context-aware**: At the start, ask if there are related project files or documents. If so, read them with the Read tool and use that context.
- **Be thorough**: Check uncovered checkpoints via \`get_context\` and steer the conversation to cover important gaps.
- **On completion**: After ending the interview, offer to update relevant project documents (plans, specs, CLAUDE.md, etc.) based on the decisions made.

## Checkpoint Strategy
- When starting, check \`recommended_path\` and \`high_value_checkpoints\` from start_interview — these reflect patterns from past interviews.
- Prioritize high-scoring checkpoints (high decision_rate) — they historically lead to concrete decisions.
- Use \`next_recommended\` from record responses as a nudge for what to explore next, but adapt to the user's flow.
- Low-score or zero-score checkpoints may still matter for this specific interview — use your judgment.

## Style
- Be conversational, not interrogative.
- If an answer is vague, ask a follow-up to clarify.
- Suggest options when the user seems unsure, but always state your recommendation first.
- Speak in the same language the user uses.

${topic ? `## Starting Topic\n${topic}\n\nBegin by asking the first question about this topic.` : "Begin by asking what the user wants to explore or build."}`,
        },
      },
    ],
  })
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
