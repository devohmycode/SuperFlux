-- ============================================================
-- SuperFlux — Bookmarks table (shared between desktop & Chrome extension)
-- ============================================================

create table bookmarks (
  id         text not null,
  user_id    uuid not null references profiles on delete cascade,
  url        text not null,
  title      text not null,
  excerpt    text,
  image      text,
  favicon    text,
  author     text,
  site_name  text,
  tags       text[] default '{}',
  note       text,
  is_read    boolean default false,
  source     text not null default 'chrome' check (source in ('chrome', 'desktop', 'mobile')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (id, user_id)
);

create index bookmarks_user_updated_idx on bookmarks (user_id, updated_at desc);
create index bookmarks_user_url_idx on bookmarks (user_id, url);

alter table bookmarks enable row level security;

create policy "Users can view own bookmarks"
  on bookmarks for select using (auth.uid() = user_id);
create policy "Users can insert own bookmarks"
  on bookmarks for insert with check (auth.uid() = user_id);
create policy "Users can update own bookmarks"
  on bookmarks for update using (auth.uid() = user_id);
create policy "Users can delete own bookmarks"
  on bookmarks for delete using (auth.uid() = user_id);

create trigger bookmarks_updated_at
  before update on bookmarks
  for each row execute function update_updated_at();
