-- A match-day photo of the man of the match, shown in the match centre.
alter table results add column if not exists motm_photo_url text;
