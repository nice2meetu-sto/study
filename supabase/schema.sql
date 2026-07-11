-- ═══════════════════════════════════════════════════════
-- 공부의 별 ⭐ — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 실행하세요.
-- (여러 번 실행해도 안전합니다)
-- ═══════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- 대분류
create table if not exists categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- 과목
create table if not exists subjects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  name        text not null,
  color       text not null default '#CFC5FF',
  status      text not null default '예정' check (status in ('예정','하는중','다함')),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- 할일 (2단계 트리: parent_id null = 큰 할일)
create table if not exists todos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  parent_id  uuid references todos(id) on delete cascade,
  text       text not null,
  done       boolean not null default false,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- 요일 배정 (플랜) — 배정 해제(✕) = row 삭제, todos 원본 유지
create table if not exists assignments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  todo_id    uuid not null references todos(id) on delete cascade,
  date       date not null,
  done       boolean not null default false,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (todo_id, date)
);

-- 기존 설치에 컬럼 추가 (여러 번 실행해도 안전)
alter table assignments add column if not exists sort_order int not null default 0;

-- 타이머 세션 (과목 삭제 시에도 기록은 남김)
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id   uuid references subjects(id) on delete set null,
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  duration_sec int not null,
  created_at   timestamptz not null default now()
);

-- 인강
create table if not exists lectures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id  uuid not null references subjects(id) on delete cascade,
  name        text not null,
  total_count int  not null default 1,
  created_at  timestamptz not null default now()
);

-- 강의별 시청 체크
create table if not exists lecture_episodes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lecture_id uuid not null references lectures(id) on delete cascade,
  no         int  not null,
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  unique (lecture_id, no)
);

-- 주요 일정 (D-day)
create table if not exists ddays (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null,
  date       date not null,
  created_at timestamptz not null default now()
);

-- ── 인덱스 ──────────────────────────────────────────────
create index if not exists idx_categories_user   on categories(user_id);
create index if not exists idx_subjects_user     on subjects(user_id);
create index if not exists idx_subjects_cat      on subjects(category_id);
create index if not exists idx_todos_user        on todos(user_id);
create index if not exists idx_todos_subject     on todos(subject_id);
create index if not exists idx_assignments_user  on assignments(user_id);
create index if not exists idx_assignments_date  on assignments(date);
create index if not exists idx_sessions_user     on sessions(user_id);
create index if not exists idx_sessions_started  on sessions(started_at);
create index if not exists idx_lectures_user     on lectures(user_id);
create index if not exists idx_episodes_user     on lecture_episodes(user_id);
create index if not exists idx_episodes_lecture  on lecture_episodes(lecture_id);
create index if not exists idx_ddays_user        on ddays(user_id);

-- ── 테이블 권한: 로그인 사용자(authenticated)에게 부여 ──
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  categories, subjects, todos, assignments,
  sessions, lectures, lecture_episodes, ddays
to authenticated;

-- ── RLS: 본인 데이터만 접근 ─────────────────────────────
alter table categories       enable row level security;
alter table subjects         enable row level security;
alter table todos            enable row level security;
alter table assignments      enable row level security;
alter table sessions         enable row level security;
alter table lectures         enable row level security;
alter table lecture_episodes enable row level security;
alter table ddays            enable row level security;

drop policy if exists own_categories on categories;
create policy own_categories on categories for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_subjects on subjects;
create policy own_subjects on subjects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_todos on todos;
create policy own_todos on todos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_assignments on assignments;
create policy own_assignments on assignments for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_sessions on sessions;
create policy own_sessions on sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_lectures on lectures;
create policy own_lectures on lectures for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_lecture_episodes on lecture_episodes;
create policy own_lecture_episodes on lecture_episodes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_ddays on ddays;
create policy own_ddays on ddays for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
