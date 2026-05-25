-- Migration v2 — research notes + document links
-- Run in Supabase Dashboard → SQL Editor

alter table opportunities add column if not exists research_notes   text not null default '';
alter table opportunities add column if not exists cover_letter_link text not null default '';
alter table opportunities add column if not exists resume_link       text not null default '';
