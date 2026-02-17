-- ============================================================
-- SuperFlux — Supabase schema
-- ============================================================

-- ---- helpers ------------------------------------------------

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---- profiles -----------------------------------------------

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();

-- auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---- user_settings ------------------------------------------

create table user_settings (
  user_id    uuid primary key references profiles on delete cascade,
  theme      text default 'system',
  settings   jsonb default '{}',
  updated_at timestamptz default now()
);

alter table user_settings enable row level security;

create policy "Users can view own settings"
  on user_settings for select using (auth.uid() = user_id);
create policy "Users can upsert own settings"
  on user_settings for insert with check (auth.uid() = user_id);
create policy "Users can update own settings"
  on user_settings for update using (auth.uid() = user_id);

create trigger user_settings_updated_at
  before update on user_settings
  for each row execute function update_updated_at();

-- ---- feeds --------------------------------------------------

create table feeds (
  id         text not null,
  user_id    uuid not null references profiles on delete cascade,
  name       text not null,
  source     text not null check (source in ('article','reddit','youtube','twitter','mastodon')),
  icon       text,
  url        text not null,
  color      text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (id, user_id)
);

create index feeds_user_id_idx on feeds (user_id);

alter table feeds enable row level security;

create policy "Users can view own feeds"
  on feeds for select using (auth.uid() = user_id);
create policy "Users can insert own feeds"
  on feeds for insert with check (auth.uid() = user_id);
create policy "Users can update own feeds"
  on feeds for update using (auth.uid() = user_id);
create policy "Users can delete own feeds"
  on feeds for delete using (auth.uid() = user_id);

create trigger feeds_updated_at
  before update on feeds
  for each row execute function update_updated_at();

-- ---- feed_items ---------------------------------------------

create table feed_items (
  id            text not null,
  user_id       uuid not null,
  feed_id       text not null,
  title         text,
  excerpt       text,
  author        text,
  published_at  timestamptz,
  url           text,
  is_read       boolean default false,
  is_starred    boolean default false,
  is_bookmarked boolean default false,
  source        text,
  feed_name     text,
  tags          text[],
  comment_count integer,
  comments_url  text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  primary key (id, user_id),
  foreign key (feed_id, user_id) references feeds (id, user_id) on delete cascade
);

create index feed_items_user_updated_idx on feed_items (user_id, updated_at);
create index feed_items_starred_idx on feed_items (user_id) where is_starred = true;
create index feed_items_bookmarked_idx on feed_items (user_id) where is_bookmarked = true;

alter table feed_items enable row level security;

create policy "Users can view own items"
  on feed_items for select using (auth.uid() = user_id);
create policy "Users can insert own items"
  on feed_items for insert with check (auth.uid() = user_id);
create policy "Users can update own items"
  on feed_items for update using (auth.uid() = user_id);
create policy "Users can delete own items"
  on feed_items for delete using (auth.uid() = user_id);

create trigger feed_items_updated_at
  before update on feed_items
  for each row execute function update_updated_at();
