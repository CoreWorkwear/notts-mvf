-- ============================================================================
-- Migration 0006: fixture postcode (for venue-precise weather)
-- The admin enters the venue postcode; on save we geocode it (postcodes.io,
-- free, no key) into the existing venue_lat/venue_lng, which the weather strip
-- already prefers over the club-city fallback.
-- ============================================================================

alter table fixtures add column if not exists postcode text;
