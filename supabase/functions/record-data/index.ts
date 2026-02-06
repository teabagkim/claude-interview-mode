// Edge Function: record-data
// Receives interview metadata from MCP server, validates, writes to DB.
// Uses service_role key (auto-injected by Supabase) — never exposed to client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

  return b as unknown as RecordPayload;
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

  const result = validate(body);
  if (typeof result === "string") {
    return new Response(JSON.stringify({ error: result }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = result;

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

  // 2. Upsert checkpoints (increment usage_count + decision_count)
  const decisionCpSet = new Set(
    payload.coverage_order
      .filter((e) => e.led_to_decision)
      .map((e) => e.checkpoint_name)
  );

  for (const cp of payload.covered_checkpoints) {
    const ledToDecision = decisionCpSet.has(cp);
    const { data: existing } = await supabase
      .from("checkpoints")
      .select("id, usage_count, decision_count")
      .eq("category", payload.category)
      .eq("name", cp)
      .single();

    if (existing) {
      await supabase
        .from("checkpoints")
        .update({
          usage_count: existing.usage_count + 1,
          decision_count: existing.decision_count + (ledToDecision ? 1 : 0),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("checkpoints").insert({
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
    if (!knownSet.has(topic)) {
      const { data: exists } = await supabase
        .from("checkpoints")
        .select("id")
        .eq("category", payload.category)
        .eq("name", topic)
        .single();

      if (!exists) {
        await supabase.from("checkpoints").insert({
          category: payload.category,
          name: topic,
          usage_count: 1,
          decision_count: 1,
        });
      }
    }
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

  // 5. Upsert checkpoint_scores (Bayesian scoring)
  for (let i = 0; i < payload.coverage_order.length; i++) {
    const event = payload.coverage_order[i];
    const position = i + 1;

    const { data: existing } = await supabase
      .from("checkpoint_scores")
      .select("id, times_covered, times_led_to_decision, avg_position, position_samples")
      .eq("category", payload.category)
      .eq("checkpoint_name", event.checkpoint_name)
      .single();

    if (existing) {
      const newCovered = existing.times_covered + 1;
      const newDecisions =
        existing.times_led_to_decision + (event.led_to_decision ? 1 : 0);
      const newSamples = existing.position_samples + 1;
      const newAvgPos =
        (Number(existing.avg_position) * existing.position_samples + position) /
        newSamples;

      await supabase
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
      await supabase.from("checkpoint_scores").insert({
        category: payload.category,
        checkpoint_name: event.checkpoint_name,
        times_covered: 1,
        times_led_to_decision: event.led_to_decision ? 1 : 0,
        decision_rate: bayesianDecisionRate(event.led_to_decision ? 1 : 0, 1),
        avg_position: position,
        position_samples: 1,
      });
    }
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
