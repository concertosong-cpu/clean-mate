-- ============================================================
-- CleanMate 백엔드 설정 — 이 파일 하나만 실행하면 됩니다
-- ============================================================
-- [실행 방법]
-- 1. supabase.com 접속 → 로그인 → 프로젝트 클릭
-- 2. 왼쪽 메뉴에서 "SQL Editor" 클릭
-- 3. "New query" 버튼 클릭
-- 4. 이 파일 내용 전체를 복사해서 붙여넣기
-- 5. 오른쪽 아래 초록색 "Run" 버튼 클릭
-- 6. 아래에 "Success" 라고 나오면 완료!
--
-- 여러 번 실행해도 안전해요 (이미 있으면 그냥 넘어갑니다).
-- ============================================================


-- ===== 1. 활동 로그 =====
-- PIN 재설정, 초대 문자 등 민감한 작업을 누가 언제 했는지 기록
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_name text not null,
  message text not null,
  created_at timestamptz default now()
);


-- ===== 2. 근태 요청 =====
-- 휴가 / 오버타임 / 대체근무 신청과 관리자 승인 결과
create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  crew_name text not null default 'Cassie',
  type text not null,
  data jsonb,
  status text default '대기',
  decided_by text,
  created_at timestamptz default now()
);


-- ===== 3. 사이트별 요일 체크리스트 =====
-- 관리자가 등록하는 청소 체크리스트 항목 목록
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  site_day text unique not null,   -- 예: "콜스 Bondi점|mon"
  site text not null,
  weekday text not null,
  items jsonb not null default '[]',
  updated_at timestamptz default now()
);


-- ===== 4. 가입 신청 =====
-- 새 직원이 앱에서 접수한 신청서와 관리자 승인/거절 결과
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


-- ============================================================
-- 접근 권한 설정 (Row Level Security)
-- ============================================================
-- ⚠️ 지금은 "누구나 읽고 쓸 수 있음"으로 열어둔 임시 상태입니다.
--    아직 직원별 실제 로그인 인증이 없어서(전원 공용 비밀번호 0000),
--    권한을 나눌 기준 자체가 없기 때문이에요.
--    내부 소규모 사용 기준으로는 괜찮지만, 실제 운영 전에는
--    로그인 인증을 붙이고 이 정책을 반드시 조여야 합니다.

alter table activity_log     enable row level security;
alter table requests         enable row level security;
alter table checklist_items  enable row level security;
alter table join_applicants  enable row level security;

-- 이미 만들어진 정책이 있으면 지우고 다시 만듭니다 (여러 번 실행해도 안전하도록)
drop policy if exists "activity_log_public_select"     on activity_log;
drop policy if exists "activity_log_public_insert"     on activity_log;
drop policy if exists "requests_public_select"         on requests;
drop policy if exists "requests_public_insert"         on requests;
drop policy if exists "requests_public_update"         on requests;
drop policy if exists "checklist_items_public_select"  on checklist_items;
drop policy if exists "checklist_items_public_insert"  on checklist_items;
drop policy if exists "checklist_items_public_update"  on checklist_items;
drop policy if exists "join_applicants_public_select"  on join_applicants;
drop policy if exists "join_applicants_public_insert"  on join_applicants;
drop policy if exists "join_applicants_public_update"  on join_applicants;

create policy "activity_log_public_select"    on activity_log    for select using (true);
create policy "activity_log_public_insert"    on activity_log    for insert with check (true);

create policy "requests_public_select"        on requests        for select using (true);
create policy "requests_public_insert"        on requests        for insert with check (true);
create policy "requests_public_update"        on requests        for update using (true);

create policy "checklist_items_public_select" on checklist_items for select using (true);
create policy "checklist_items_public_insert" on checklist_items for insert with check (true);
create policy "checklist_items_public_update" on checklist_items for update using (true);

create policy "join_applicants_public_select" on join_applicants for select using (true);
create policy "join_applicants_public_insert" on join_applicants for insert with check (true);
create policy "join_applicants_public_update" on join_applicants for update using (true);


-- ============================================================
-- 끝! "Success" 메시지가 보이면 정상적으로 완료된 거예요.
--
-- 확인해보고 싶으시면 왼쪽 메뉴 "Table Editor"를 눌러보세요.
-- activity_log, requests, checklist_items, join_applicants
-- 이렇게 표 4개가 만들어져 있으면 성공입니다.
-- ============================================================


-- ===== v3.9 추가: 출퇴근 기록 / 근무지 / 크루 / 공지 =====
create table if not exists clock_records (
  id uuid primary key default gen_random_uuid(),
  crew_name text not null,
  site text,
  type text not null,            -- 'in' | 'out'
  at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  distance_m integer,
  created_at timestamptz default now()
);
create index if not exists clock_records_at_idx on clock_records (at desc);
create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  address text,
  type text,
  lat double precision,
  lng double precision,
  note text,
  created_at timestamptz default now()
);
create table if not exists crew (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  phone text,
  address text,
  site text,
  start_date text,
  role text default 'crew',
  active boolean default true,
  created_at timestamptz default now()
);
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  author text,
  active boolean default true,
  created_at timestamptz default now()
);
alter table clock_records enable row level security;
alter table sites         enable row level security;
alter table crew          enable row level security;
alter table notices       enable row level security;
drop policy if exists "clock_records_public_all" on clock_records;
drop policy if exists "sites_public_all"         on sites;
drop policy if exists "crew_public_all"          on crew;
drop policy if exists "notices_public_all"       on notices;
create policy "clock_records_public_all" on clock_records for all using (true) with check (true);
create policy "sites_public_all"         on sites         for all using (true) with check (true);
create policy "crew_public_all"          on crew          for all using (true) with check (true);
create policy "notices_public_all"       on notices       for all using (true) with check (true);


-- ===== v4.0 추가: 개인별 PIN / 관리자 비밀번호(서버 공유) =====
alter table crew add column if not exists pin_hash text;
alter table crew add column if not exists must_change_pin boolean default false;
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);
alter table app_settings enable row level security;
drop policy if exists "app_settings_public_all" on app_settings;
create policy "app_settings_public_all" on app_settings for all using (true) with check (true);
