-- ============================================================
-- SuperFlux — Notes (SuperNote)
-- Idempotent: safe to re-run if table already exists
-- ============================================================

create table if not exists notes (
  id              text not null,
  user_id         uuid not null references profiles on delete cascade,
  title           text not null default 'Sans titre',
  content         text not null default '',
  folder          text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  primary key (id, user_id)
);

-- Add sticky board columns if missing
alter table notes add column if not exists sticky_x        double precision;
alter table notes add column if not exists sticky_y        double precision;
alter table notes add column if not exists sticky_rotation double precision;
alter table notes add column if not exists sticky_z_index  integer;
alter table notes add column if not exists sticky_color    text;
alter table notes add column if not exists sticky_width    double precision;
alter table notes add column if not exists sticky_height   double precision;

create index if not exists notes_user_updated_idx on notes (user_id, updated_at desc);
create index if not exists notes_user_folder_idx  on notes (user_id, folder);

alter table notes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'notes' and policyname = 'Users can view own notes') then
    create policy "Users can view own notes" on notes for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notes' and policyname = 'Users can insert own notes') then
    create policy "Users can insert own notes" on notes for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notes' and policyname = 'Users can update own notes') then
    create policy "Users can update own notes" on notes for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notes' and policyname = 'Users can delete own notes') then
    create policy "Users can delete own notes" on notes for delete using (auth.uid() = user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'notes_updated_at') then
    create trigger notes_updated_at
      before update on notes
      for each row execute function update_updated_at();
  end if;
end $$;
