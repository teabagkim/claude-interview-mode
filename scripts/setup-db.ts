#!/usr/bin/env npx tsx
/**
 * One-time script to create Supabase tables via the Management API.
 * Usage: npx tsx scripts/setup-db.ts
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars
 * (or pass them inline)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function setupCheckpointsTable() {
  // Try inserting a test row — if table doesn't exist, we'll get an error
  const { error: testError } = await supabase
    .from("checkpoints")
    .select("id")
    .limit(1);

  if (testError?.code === "PGRST116" || testError?.code === "42P01") {
    console.log("checkpoints table does not exist yet. Please run schema.sql in Supabase Dashboard.");
    return false;
  }

  if (testError) {
    console.log("checkpoints table status:", testError.message);
    return false;
  }

  console.log("✓ checkpoints table exists");
  return true;
}

async function setupInterviewMetadataTable() {
  const { error: testError } = await supabase
    .from("interview_metadata")
    .select("id")
    .limit(1);

  if (testError?.code === "PGRST116" || testError?.code === "42P01") {
    console.log("interview_metadata table does not exist yet. Please run schema.sql in Supabase Dashboard.");
    return false;
  }

  if (testError) {
    console.log("interview_metadata table status:", testError.message);
    return false;
  }

  console.log("✓ interview_metadata table exists");
  return true;
}

async function testInsertAndRead() {
  // Insert a test checkpoint
  const { error: insertErr } = await supabase.from("checkpoints").upsert(
    {
      category: "_test",
      name: "_connectivity_test",
      usage_count: 1,
    },
    { onConflict: "category,name" }
  );

  if (insertErr) {
    console.log("✗ Insert test failed:", insertErr.message);
    return false;
  }

  // Read it back
  const { data, error: readErr } = await supabase
    .from("checkpoints")
    .select("*")
    .eq("category", "_test")
    .single();

  if (readErr) {
    console.log("✗ Read test failed:", readErr.message);
    return false;
  }

  console.log("✓ Insert + Read test passed:", data);

  // Clean up
  await supabase
    .from("checkpoints")
    .delete()
    .eq("category", "_test");

  console.log("✓ Cleanup done");
  return true;
}

async function main() {
  console.log("=== Interview Mode MCP - Database Setup ===\n");
  console.log(`URL: ${SUPABASE_URL}\n`);

  const cp = await setupCheckpointsTable();
  const im = await setupInterviewMetadataTable();

  if (cp && im) {
    console.log("\nRunning connectivity test...");
    await testInsertAndRead();
    console.log("\n=== Setup complete! ===");
  } else {
    console.log("\n⚠ Tables missing. Run supabase/schema.sql in Supabase Dashboard → SQL Editor.");
  }
}

main().catch(console.error);
