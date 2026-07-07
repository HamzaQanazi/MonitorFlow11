-- Spec v5 map amendment: denormalized request location, written once inside
-- POST /requests (form_response is immutable, so no sync logic — the
-- TASK.status precedent). Null when the form has no location field or the
-- optional field was left empty.
ALTER TABLE request ADD COLUMN location_lat double precision;
ALTER TABLE request ADD COLUMN location_lng double precision;
