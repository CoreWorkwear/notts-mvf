-- Add a fourth sponsor tier: club partners.
alter table sponsors drop constraint if exists sponsors_tier_check;
alter table sponsors add constraint sponsors_tier_check check (tier in ('main','kit','motm','partner'));
