-- Phase 6 (CLAUDE.md §10): PostGIS. The denormalized request pin becomes a
-- real GEOGRAPHY(Point,4326) column + GIST index — map pins work the same
-- today; genuine spatial analysis later needs new queries, not a migration
-- (combineidea.md). API shape is unchanged: reads alias ST_Y/ST_X back to
-- lat/lng, so no client changes.
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE request ADD COLUMN location geography(Point, 4326);
UPDATE request
  SET location = ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography
  WHERE location_lat IS NOT NULL;
ALTER TABLE request DROP COLUMN location_lat, DROP COLUMN location_lng;

CREATE INDEX idx_request_location ON request USING GIST (location);
