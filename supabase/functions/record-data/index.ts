// Edge Function: record-data (deployed as super-api)
// Receives interview metadata from MCP server, validates, normalizes, writes to DB.
// Uses service_role key (auto-injected by Supabase) — never exposed to client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// --- Normalization ---

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

// --- Validation ---

interface CoverageEvent {
  checkpoint_name: string;
  led_to_decision: boolean;
}

interface RecordPayload {
  category: string;
  covered_checkpoints: string[];
  checkpoints_total: number;
  total_qas: number;
  total_decisions: number;
  duration_seconds: number;
  coverage_order: CoverageEvent[];
  decision_topics: string[];
  known_checkpoint_names: string[];
}

function validate(body: unknown): RecordPayload | string {
  if (!body || typeof body !== "object") return "Invalid body";
  const b = body as Record<string, unknown>;

  if (typeof b.category !== "string" || b.category.length < 1 || b.category.length > 200)
    return "Invalid category";
  if (!Array.isArray(b.covered_checkpoints) || b.covered_checkpoints.length > 100)
    return "Invalid covered_checkpoints";
  if (typeof b.checkpoints_total !== "number" || b.checkpoints_total < 0 || b.checkpoints_total > 500)
    return "Invalid checkpoints_total";
  if (typeof b.total_qas !== "number" || b.total_qas < 0 || b.total_qas > 500)
    return "Invalid total_qas";
  if (typeof b.total_decisions !== "number" || b.total_decisions < 0 || b.total_decisions > 500)
    return "Invalid total_decisions";
  if (typeof b.duration_seconds !== "number" || b.duration_seconds < 0 || b.duration_seconds > 86400)
    return "Invalid duration_seconds";
  if (!Array.isArray(b.coverage_order) || b.coverage_order.length > 100)
    return "Invalid coverage_order";
  if (!Array.isArray(b.decision_topics) || b.decision_topics.length > 100)
    return "Invalid decision_topics";
  if (!Array.isArray(b.known_checkpoint_names) || b.known_checkpoint_names.length > 500)
    return "Invalid known_checkpoint_names";

  // Validate string lengths in arrays
  for (const s of b.covered_checkpoints as string[]) {
    if (typeof s !== "string" || s.length > 200) return "Invalid checkpoint name";
  }
  for (const e of b.coverage_order as CoverageEvent[]) {
    if (typeof e.checkpoint_name !== "string" || e.checkpoint_name.length > 200)
      return "Invalid coverage event";
    if (typeof e.led_to_decision !== "boolean") return "Invalid coverage event";
  }
  for (const s of b.decision_topics as string[]) {
    if (typeof s !== "string" || s.length > 200) return "Invalid decision topic";
  }

  return b as unknown as RecordPayload;
}

// --- Normalize payload ---

function normalizePayload(payload: RecordPayload): RecordPayload {
  return {
    ...payload,
    category: normalizeKey(payload.category),
    covered_checkpoints: payload.covered_checkpoints.map(normalizeKey),
    coverage_order: payload.coverage_order.map((e) => ({
      checkpoint_name: normalizeKey(e.checkpoint_name),
      led_to_decision: e.led_to_decision,
    })),
    decision_topics: payload.decision_topics.map(normalizeKey),
    known_checkpoint_names: payload.known_checkpoint_names.map(normalizeKey),
  };
}

// --- Spam/anomaly defense ---

function isSpamOrEmpty(payload: RecordPayload): string | null {
  // Reject empty interviews (no QAs and no decisions)
  if (payload.total_qas === 0 && payload.total_decisions === 0) {
    return "Empty interview: no QAs or decisions recorded";
  }

  // Reject suspiciously short sessions (< 10 seconds with content)
  if (payload.duration_seconds < 10 && payload.total_qas > 0) {
    return "Session too short for recorded content";
  }

  // Reject implausible ratios (e.g., 100 decisions in 30 seconds)
  if (payload.total_decisions > 0 && payload.duration_seconds > 0) {
    const decisionsPerMinute = (payload.total_decisions / payload.duration_seconds) * 60;
    if (decisionsPerMinute > 30) {
      return "Implausible decision rate";
    }
  }

  // Reject if covered checkpoints exceed total available
  if (payload.covered_checkpoints.length > payload.checkpoints_total + payload.total_decisions) {
    return "Covered checkpoints exceed available checkpoints";
  }

  return null;
}

// --- Scoring ---

function bayesianDecisionRate(decisions: number, covered: number): number {
  const PRIOR_ALPHA = 0.6;
  const PRIOR_BETA = 2;
  return (decisions + PRIOR_ALPHA) / (covered + PRIOR_BETA);
}

// --- Handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const validated = validate(body);
  if (typeof validated === "string") {
    return new Response(JSON.stringify({ error: validated }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Normalize all keys
  const payload = normalizePayload(validated);

  // Spam/anomaly check
  const spamReason = isSpamOrEmpty(payload);
  if (spamReason) {
    return new Response(JSON.stringify({ error: spamReason }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Service role client — full DB access, auto-injected by Supabase
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const errors: string[] = [];

  // 1. Insert interview_metadata
  const { error: metaErr } = await supabase.from("interview_metadata").insert({
    category: payload.category,
    checkpoints_covered: payload.covered_checkpoints,
    checkpoints_total: payload.checkpoints_total,
    total_qas: payload.total_qas,
    total_decisions: payload.total_decisions,
    duration_seconds: payload.duration_seconds,
  });
  if (metaErr) errors.push(`interview_metadata: ${metaErr.message}`);

  // 2. Batch: load all existing checkpoints for this category at once
  const { data: existingCheckpoints } = await supabase
    .from("checkpoints")
    .select("id, name, usage_count, decision_count")
    .eq("category", payload.category);

  const cpMap = new Map(
    (existingCheckpoints ?? []).map((cp) => [cp.name, cp])
  );

  // Build decision checkpoint set
  const decisionCpSet = new Set(
    payload.coverage_order
      .filter((e) => e.led_to_decision)
      .map((e) => e.checkpoint_name)
  );

  // Upsert covered checkpoints
  const cpInserts: Array<{ category: string; name: string; usage_count: number; decision_count: number }> = [];
  const cpUpdates: Array<{ id: number; usage_count: number; decision_count: number }> = [];

  for (const cp of payload.covered_checkpoints) {
    const ledToDecision = decisionCpSet.has(cp);
    const existing = cpMap.get(cp);

    if (existing) {
      cpUpdates.push({
        id: existing.id,
        usage_count: existing.usage_count + 1,
        decision_count: existing.decision_count + (ledToDecision ? 1 : 0),
      });
    } else {
      cpInserts.push({
        category: payload.category,
        name: cp,
        usage_count: 1,
        decision_count: ledToDecision ? 1 : 0,
      });
    }
  }

  // 3. Discover new checkpoints from decision topics
  const knownSet = new Set(payload.known_checkpoint_names);
  for (const topic of payload.decision_topics) {
    if (!knownSet.has(topic) && !cpMap.has(topic) && !cpInserts.some((i) => i.name === topic)) {
      cpInserts.push({
        category: payload.category,
        name: topic,
        usage_count: 1,
        decision_count: 1,
      });
    }
  }

  // Batch insert new checkpoints
  if (cpInserts.length > 0) {
    const { error: insertErr } = await supabase.from("checkpoints").insert(cpInserts);
    if (insertErr) errors.push(`checkpoints insert: ${insertErr.message}`);
  }

  // Update existing checkpoints (batch not supported by Supabase REST, but we can parallelize)
  const updateResults = await Promise.all(
    cpUpdates.map((u) =>
      supabase
        .from("checkpoints")
        .update({ usage_count: u.usage_count, decision_count: u.decision_count })
        .eq("id", u.id)
    )
  );
  for (const r of updateResults) {
    if (r.error) errors.push(`checkpoints update: ${r.error.message}`);
  }

  // 4. Insert interview_patterns
  const { error: patternErr } = await supabase
    .from("interview_patterns")
    .insert({
      category: payload.category,
      coverage_sequence: payload.coverage_order.map((e) => e.checkpoint_name),
      decision_checkpoints: payload.coverage_order
        .filter((e) => e.led_to_decision)
        .map((e) => e.checkpoint_name),
      total_qas: payload.total_qas,
      total_decisions: payload.total_decisions,
      total_checkpoints_available: payload.checkpoints_total,
    });
  if (patternErr) errors.push(`interview_patterns: ${patternErr.message}`);

  // 5. Batch: load all existing checkpoint_scores for this category
  const { data: existingScores } = await supabase
    .from("checkpoint_scores")
    .select("id, checkpoint_name, times_covered, times_led_to_decision, avg_position, position_samples")
    .eq("category", payload.category);

  const scoreMap = new Map(
    (existingScores ?? []).map((s) => [s.checkpoint_name, s])
  );

  // Prepare score inserts and updates
  const scoreInserts: Array<{
    category: string;
    checkpoint_name: string;
    times_covered: number;
    times_led_to_decision: number;
    decision_rate: number;
    avg_position: number;
    position_samples: number;
  }> = [];
  const scoreUpdates: Array<{
    id: number;
    times_covered: number;
    times_led_to_decision: number;
    decision_rate: number;
    avg_position: number;
    position_samples: number;
  }> = [];

  for (let i = 0; i < payload.coverage_order.length; i++) {
    const event = payload.coverage_order[i];
    const position = i + 1;
    const existing = scoreMap.get(event.checkpoint_name);

    if (existing) {
      const newCovered = existing.times_covered + 1;
      const newDecisions =
        existing.times_led_to_decision + (event.led_to_decision ? 1 : 0);
      const newSamples = existing.position_samples + 1;
      const newAvgPos =
        (Number(existing.avg_position) * existing.position_samples + position) /
        newSamples;

      scoreUpdates.push({
        id: existing.id,
        times_covered: newCovered,
        times_led_to_decision: newDecisions,
        decision_rate: bayesianDecisionRate(newDecisions, newCovered),
        avg_position: +newAvgPos.toFixed(2),
        position_samples: newSamples,
      });

      // Update scoreMap for subsequent events referencing same checkpoint
      existing.times_covered = newCovered;
      existing.times_led_to_decision = newDecisions;
      existing.avg_position = +newAvgPos.toFixed(2);
      existing.position_samples = newSamples;
    } else {
      const decRate = bayesianDecisionRate(event.led_to_decision ? 1 : 0, 1);
      scoreInserts.push({
        category: payload.category,
        checkpoint_name: event.checkpoint_name,
        times_covered: 1,
        times_led_to_decision: event.led_to_decision ? 1 : 0,
        decision_rate: decRate,
        avg_position: position,
        position_samples: 1,
      });

      // Add to scoreMap in case same checkpoint appears again in this coverage_order
      scoreMap.set(event.checkpoint_name, {
        id: -1,
        checkpoint_name: event.checkpoint_name,
        times_covered: 1,
        times_led_to_decision: event.led_to_decision ? 1 : 0,
        avg_position: position,
        position_samples: 1,
      });
    }
  }

  // Batch insert new scores
  if (scoreInserts.length > 0) {
    const { error: sInsertErr } = await supabase.from("checkpoint_scores").insert(scoreInserts);
    if (sInsertErr) errors.push(`checkpoint_scores insert: ${sInsertErr.message}`);
  }

  // Parallel update existing scores
  const scoreUpdateResults = await Promise.all(
    scoreUpdates.map((u) =>
      supabase
        .from("checkpoint_scores")
        .update({
          times_covered: u.times_covered,
          times_led_to_decision: u.times_led_to_decision,
          decision_rate: u.decision_rate,
          avg_position: u.avg_position,
          position_samples: u.position_samples,
        })
        .eq("id", u.id)
    )
  );
  for (const r of scoreUpdateResults) {
    if (r.error) errors.push(`checkpoint_scores update: ${r.error.message}`);
  }

  const status = errors.length > 0 ? 207 : 200;
  return new Response(
    JSON.stringify({ ok: errors.length === 0, errors }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
