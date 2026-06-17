-- How a team is named in matchups / the league table (its competitive identity),
-- separate from its internal tier label ("First Team" / "Community"). The First
-- Team competes as "Nottingham"; Community keeps its label (match_name null).
alter table teams add column if not exists match_name text;
update teams set match_name = 'Nottingham' where key = 'xl';
