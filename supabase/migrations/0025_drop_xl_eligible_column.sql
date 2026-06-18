-- ============================================================================
-- Migration 0025: §1 final — physically retire the xl_eligible column.
-- Nothing references it: RLS uses the club-scoped can_select_fixture (0023),
-- the trigger/protect functions were cleaned (0024), and the frontend + edge
-- functions were redeployed without it. The eligibility concept is fully gone.
-- ============================================================================
alter table profiles drop column if exists xl_eligible;
