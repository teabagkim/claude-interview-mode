-- Interview Mode MCP - Supabase Schema
-- 개인 내용 없음. 메타데이터(카테고리, 체크포인트, 패턴)만 저장.

-- 카테고리별 체크포인트 사전 (사용할수록 확장)
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

-- 인터뷰 세션 메타데이터 (개인 내용 제외)
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

-- 체크포인트 업데이트 시 updated_at 자동 갱신
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

-- RLS (Row Level Security) - 공개 읽기/쓰기 (anon key 사용)
alter table checkpoints enable row level security;
alter table interview_metadata enable row level security;

create policy "Public read checkpoints" on checkpoints for select using (true);
create policy "Public insert checkpoints" on checkpoints for insert with check (true);
create policy "Public update checkpoints" on checkpoints for update using (true);

create policy "Public read interview_metadata" on interview_metadata for select using (true);
create policy "Public insert interview_metadata" on interview_metadata for insert with check (true);
