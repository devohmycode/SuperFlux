-- ============================================================
-- SuperFlux — Pro status (server-side source of truth)
-- ============================================================

alter table profiles add column if not exists is_pro boolean default false;
alter table profiles add column if not exists license_key text;
alter table profiles add column if not exists lemon_instance_id text;

-- Replace the UPDATE policy to prevent clients from modifying is_pro / license_key directly.
-- Only the Edge Function (running as service_role) can change these columns.
drop policy if exists "Users can update own profile" on profiles;

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id)
  with check (
    is_pro = (select p.is_pro from profiles p where p.id = auth.uid())
    and license_key is not distinct from (select p.license_key from profiles p where p.id = auth.uid())
    and lemon_instance_id is not distinct from (select p.lemon_instance_id from profiles p where p.id = auth.uid())
  );
