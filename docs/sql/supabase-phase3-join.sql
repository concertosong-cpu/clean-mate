-- ===== CleanMate 백엔드 3단계: 가입 신청 공유 =====
-- Supabase 대시보드 왼쪽 메뉴 "SQL Editor" 클릭 → 아래 내용 전체를 붙여넣고 "Run" 클릭하세요.
-- 이 3단계에서는 "가입 신청" (새 직원이 앱에서 접수한 신청서 + 관리자 승인/거절)이
-- 여러 관리자/기기에서 같이 보이고 처리되게 만듭니다.

create table if not exists join_applicants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  gender text,
  birth text,
  address text,
  guardian text,
  start_date text,
  status text default '대기',
  decided_by text,
  created_at timestamptz default now()
);

-- Row Level Security 켜기 (지금은 "누구나 읽고 쓸 수 있음"으로 열어둠 - 아직 실 인증이 없어서 임시 조치)
alter table join_applicants enable row level security;

create policy if not exists "join_applicants_public_select" on join_applicants for select using (true);
create policy if not exists "join_applicants_public_insert" on join_applicants for insert with check (true);
create policy if not exists "join_applicants_public_update" on join_applicants for update using (true);
