-- ===== CleanMate 백엔드 1단계: 지금 바로 실행할 SQL =====
-- Supabase 대시보드 왼쪽 메뉴 "SQL Editor" 클릭 → 아래 내용 전체를 붙여넣고 "Run" 클릭하세요.
-- 이 1단계에서는 "활동 로그"와 "근태 요청(휴가/오버타임/대체근무)" 두 가지를
-- 여러 명이 실제로 같이 보고 쓸 수 있게 만듭니다. (나머지 기능은 다음 단계에서 순차 반영)

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_name text not null,
  message text not null,
  created_at timestamptz default now()
);

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  crew_name text not null default 'Cassie',
  type text not null,
  data jsonb,
  status text default '대기',
  decided_by text,
  created_at timestamptz default now()
);

-- Row Level Security 켜기 (지금은 "누구나 읽고 쓸 수 있음"으로 열어둠 - 아직 실 인증이 없어서 임시 조치)
alter table activity_log enable row level security;
alter table requests enable row level security;

create policy if not exists "activity_log_public_select" on activity_log for select using (true);
create policy if not exists "activity_log_public_insert" on activity_log for insert with check (true);

create policy if not exists "requests_public_select" on requests for select using (true);
create policy if not exists "requests_public_insert" on requests for insert with check (true);
create policy if not exists "requests_public_update" on requests for update using (true);
