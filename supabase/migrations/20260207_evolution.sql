-- Phase 5: Evolution System - checkpoint_scores + interview_patterns

-- 체크포인트별 품질 점수 (베이지안 스무딩 적용)
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

alter table checkpoint_scores enable row level security;
create policy "Public read checkpoint_scores" on checkpoint_scores for select using (true);
create policy "Public insert checkpoint_scores" on checkpoint_scores for insert with check (true);
create policy "Public update checkpoint_scores" on checkpoint_scores for update using (true);

-- 세션별 커버리지 시퀀스 (패턴 분석용, append-only)
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

alter table interview_patterns enable row level security;
create policy "Public read interview_patterns" on interview_patterns for select using (true);
create policy "Public insert interview_patterns" on interview_patterns for insert with check (true);
