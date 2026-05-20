-- Opportunity Tracker — Supabase Schema
-- Run this in the Supabase Dashboard → SQL Editor

-- ── Table ────────────────────────────────────────────────────────────────────

create table if not exists opportunities (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,
  org                text        not null default '',
  role               text        not null default '',
  type               text        not null default 'Other',
  status             text        not null default 'Researching',
  deadline           date,
  applied_date       date,
  follow_ups         jsonb       not null default '[]',
  interview_date     date,
  interview_notes    text        not null default '',
  recurring_reminder text        not null default 'none',
  link               text        not null default '',
  notes              text        not null default '',
  calendar_event_ids jsonb       not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── Index ─────────────────────────────────────────────────────────────────────

create index if not exists opportunities_user_id_idx on opportunities (user_id);

-- ── Auto-update updated_at ────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists opportunities_updated_at on opportunities;
create trigger opportunities_updated_at
  before update on opportunities
  for each row execute function update_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table opportunities enable row level security;

-- Drop existing policies to allow re-running this script safely
drop policy if exists "select_own"  on opportunities;
drop policy if exists "insert_own"  on opportunities;
drop policy if exists "update_own"  on opportunities;
drop policy if exists "delete_own"  on opportunities;

create policy "select_own" on opportunities
  for select using (auth.uid() = user_id);

create policy "insert_own" on opportunities
  for insert with check (auth.uid() = user_id);

create policy "update_own" on opportunities
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete_own" on opportunities
  for delete using (auth.uid() = user_id);
