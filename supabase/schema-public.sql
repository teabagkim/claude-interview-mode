-- Interview Mode MCP - Public Supabase Schema
-- anon key = READ ONLY. Writes go through Edge Function (service_role).
-- No personal content stored. Metadata only (categories, checkpoint names, counts).

-- Category checkpoint dictionary (grows with usage)
create table if not exists checkpoints (
  id bigint generated always as identity primary key,
  category text not null,
  name text not null,
  usage_count int default 0,
  decision_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (category, name)
);

-- Interview session metadata (no personal content)
create table if not exists interview_metadata (
  id bigint generated always as identity primary key,
  category text not null,
  checkpoints_covered text[] default '{}',
  checkpoints_total int default 0,
  total_qas int default 0,
  total_decisions int default 0,
  duration_seconds int default 0,
  created_at timestamptz default now()
);

-- Auto-update updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger checkpoints_updated_at
  before update on checkpoints
  for each row execute function update_updated_at();

-- Checkpoint quality scores (Bayesian evolution system)
create table if not exists checkpoint_scores (
  id bigint generated always as identity primary key,
  category text not null,
  checkpoint_name text not null,
  times_covered int default 0,
  times_led_to_decision int default 0,
  decision_rate numeric(5,4) default 0.0,
  avg_position numeric(5,2) default 0.0,
  position_samples int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (category, checkpoint_name)
);

create trigger checkpoint_scores_updated_at
  before update on checkpoint_scores
  for each row execute function update_updated_at();

-- Per-session coverage sequences (pattern analysis)
create table if not exists interview_patterns (
  id bigint generated always as identity primary key,
  category text not null,
  coverage_sequence text[] default '{}',
  decision_checkpoints text[] default '{}',
  total_qas int default 0,
  total_decisions int default 0,
  total_checkpoints_available int default 0,
  created_at timestamptz default now()
);

-- RLS: anon key = READ ONLY
alter table checkpoints enable row level security;
alter table interview_metadata enable row level security;
alter table checkpoint_scores enable row level security;
alter table interview_patterns enable row level security;

create policy "anon_read_checkpoints" on checkpoints for select using (true);
create policy "anon_read_interview_metadata" on interview_metadata for select using (true);
create policy "anon_read_checkpoint_scores" on checkpoint_scores for select using (true);
create policy "anon_read_interview_patterns" on interview_patterns for select using (true);
