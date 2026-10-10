-- ===== CleanMate 백엔드 2단계: 체크리스트 공유 =====
-- Supabase 대시보드 왼쪽 메뉴 "SQL Editor" 클릭 → 아래 내용 전체를 붙여넣고 "Run" 클릭하세요.
-- 이 2단계에서는 "사이트별 요일 체크리스트" (관리자가 등록하는 항목 목록)를
-- 여러 관리자/기기에서 같이 보고 등록/수정할 수 있게 만듭니다.
-- (직원별 체크 완료 기록은 아직 이 단계에 포함되지 않음 - 실 로그인 인증이 붙은 뒤 다음 단계에서 진행 예정)

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  site_day text unique not null,   -- 예: "콜스 Bondi점|mon"
  site text not null,
  weekday text not null,
  items jsonb not null default '[]',
  updated_at timestamptz default now()
);

-- Row Level Security 켜기 (지금은 "누구나 읽고 쓸 수 있음"으로 열어둠 - 아직 실 인증이 없어서 임시 조치)
alter table checklist_items enable row level security;

create policy if not exists "checklist_items_public_select" on checklist_items for select using (true);
create policy if not exists "checklist_items_public_insert" on checklist_items for insert with check (true);
create policy if not exists "checklist_items_public_update" on checklist_items for update using (true);
