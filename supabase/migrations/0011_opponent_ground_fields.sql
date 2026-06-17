-- Opponents carry their home ground in the same shape as a fixture's venue
-- (venue + address + postcode), so Add Fixture can auto-fill from the opponent.
-- home_venue already exists (0004); add the matching address + postcode.
alter table opponents add column if not exists home_address  text;
alter table opponents add column if not exists home_postcode text;
