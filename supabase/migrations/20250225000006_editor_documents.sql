-- ============================================================
-- SuperFlux — Editor documents (SuperEditor)
-- ============================================================

create table editor_documents (
  id         text not null,
  user_id    uuid not null references profiles on delete cascade,
  title      text not null default 'Sans titre',
  content    text not null default '',
  folder     text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (id, user_id)
);

create index editor_documents_user_updated_idx on editor_documents (user_id, updated_at desc);
create index editor_documents_user_folder_idx on editor_documents (user_id, folder);

alter table editor_documents enable row level security;

create policy "Users can view own editor documents"
  on editor_documents for select using (auth.uid() = user_id);
create policy "Users can insert own editor documents"
  on editor_documents for insert with check (auth.uid() = user_id);
create policy "Users can update own editor documents"
  on editor_documents for update using (auth.uid() = user_id);
create policy "Users can delete own editor documents"
  on editor_documents for delete using (auth.uid() = user_id);

create trigger editor_documents_updated_at
  before update on editor_documents
  for each row execute function update_updated_at();
