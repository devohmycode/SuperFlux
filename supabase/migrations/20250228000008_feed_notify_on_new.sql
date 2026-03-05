-- Add notify_on_new column to feeds table
alter table feeds add column if not exists notify_on_new boolean default false;
