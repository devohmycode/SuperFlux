-- Add 'podcast' to the feeds source CHECK constraint (needed for Android app)
alter table feeds drop constraint feeds_source_check;
alter table feeds add constraint feeds_source_check check (source in ('article','reddit','youtube','twitter','mastodon','podcast'));
