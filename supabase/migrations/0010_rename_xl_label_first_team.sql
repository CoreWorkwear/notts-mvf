-- Display-label change only: "XL 11s" → "First Team". The team KEY stays 'xl'
-- (all code/RLS keys off 'xl'); only the human-facing label changes. The league
-- name (the actual competition) is left as-is.
update teams set label = 'First Team' where key = 'xl';
