-- CleanMate 백엔드 데이터베이스 설계 (Supabase / PostgreSQL)
-- 이 파일은 Supabase 프로젝트의 SQL Editor에 붙여넣어 실행하면
-- 지금까지 만든 localStorage 기반 기능들을 그대로 옮길 수 있는 테이블 구조입니다.
-- podo님이 Project URL + anon public 키를 전달해주시면, 이 스키마를 기준으로
-- app.js의 lsGet/lsSet 호출부를 실제 Supabase 호출로 교체하는 작업을 진행합니다.

-- 1. 사이트 (근무지)
create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,               -- 예: "콜스 Bondi점"
  address text,
  site_type text,                    -- "상업시설" | "주택"
  created_at timestamptz default now()
);

-- 2. 크루/관리자 (직원)
create table crew_members (
  id uuid primary key default auth.uid(),  -- Supabase Auth 계정과 1:1 연결
  name text not null,
  phone text,
  gender text,
  birth_date date,
  address text,
  guardian_phone text,
  start_date date not null,          -- 근무 시작일 (induction 만료일 = start_date + 1년)
  pin_hash text,                     -- PIN은 평문 저장 금지, 해시로 저장
  role text not null default 'staff', -- 'owner' | 'manager' | 'supervisor' | 'staff'
  site_id uuid references sites(id),
  status text default 'off',         -- 'working' | 'off'
  clock_in_at timestamptz,
  created_at timestamptz default now()
);

-- 3. 출퇴근 기록
create table clock_events (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid references crew_members(id),
  type text not null,                -- 'clock-in' | 'clock-out'
  site_id uuid references sites(id),
  lat double precision,
  lng double precision,
  occurred_at timestamptz default now()
);

-- 4. 근태 요청 (휴가/오버타임/대체근무)
create table requests (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid references crew_members(id),
  type text not null,                -- 'leave' | 'overtime' | 'substitute'
  data jsonb,                        -- 요청 상세(날짜, 사유, 대상자 등)
  status text default '대기',         -- '대기' | '승인' | '거절'
  decided_by uuid references crew_members(id),
  created_at timestamptz default now()
);

-- 5. 가입 신청 (Join)
create table join_applicants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  gender text,
  birth_date date,
  address text,
  guardian_phone text,
  start_date date,
  status text default '대기',         -- '대기' | '승인' | '거절'
  decided_by uuid references crew_members(id),
  created_at timestamptz default now()
);

-- 6. 사이트별 요일 체크리스트
create table checklists (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id),
  weekday text not null,             -- 'mon'..'sun'
  item_text text not null,
  sort_order int default 0
);

-- 7. 체크리스트 완료 기록 (날짜별)
create table checklist_progress (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid references crew_members(id),
  checklist_item_id uuid references checklists(id),
  work_date date not null,
  checked boolean default false,
  checked_at timestamptz
);

-- 8. 캘린더 이벤트 (근무 일정 + 개인/미팅 업무)
create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,                -- 'staff' | 'personal'
  label text not null,
  site_id uuid references sites(id),
  crew_id uuid references crew_members(id),
  visible_to text[] default array['owner'], -- 이 이벤트를 볼 수 있는 최소 역할들
  starts_at timestamptz not null,
  created_at timestamptz default now()
);

-- 9. 활동 로그 (민감 작업 감사기록)
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references crew_members(id),
  message text not null,
  created_at timestamptz default now()
);

-- 10. 공개 예약(부킹) - 인스타 링크로 들어오는 상담 예약용
create table bookings (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text,
  customer_email text,
  requested_at timestamptz not null,  -- 예약 희망 일시
  status text default '대기',          -- '대기' | '확정' | '취소'
  note text,
  created_at timestamptz default now()
);

-- 11. 관리자 설정 (앱 전역 설정값 - 관리자 비밀번호 해시 등)
create table admin_settings (
  key text primary key,
  value text
);

-- ===== Row Level Security (RLS) 정책 =====
-- Supabase는 기본적으로 RLS를 켜서 "로그인한 사용자만, 본인 역할에 맞는 데이터만" 보게 만드는 걸 권장합니다.
-- 아래는 이후 인증 방식이 확정되면 함께 설계할 정책의 뼈대입니다 (지금은 실행하지 않아도 됩니다).
-- alter table crew_members enable row level security;
-- alter table requests enable row level security;
-- ... (역할별 정책은 인증 방식 확정 후 추가)
