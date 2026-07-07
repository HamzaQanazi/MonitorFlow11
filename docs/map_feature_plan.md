# Map Feature — Spec v5 Amendment

## Context

Both students agreed to add a map feature (freeze slips to next Monday): users pick the problem location on a map when creating a request; employees see their active tasks on a map; monitors see a department-scoped, clustered request map with filters. This deliberately reverses ONE Section 12 cut ("interactive map pin picker") and must be documented as an amendment (v4 precedent: `docs/spec_v4_amendment.md`). **Continuous GPS tracking stays removed** — employees appear only via their assigned tasks' pins/labels.

Agreed decisions: employees-at-task-locations (no GPS) · new `location` form field type (9th) · OpenStreetMap stack (`flutter_map` mobile, `react-leaflet` + cluster web — no API keys/billing) · no new pages (view-mode toggles + a field widget).

## Architecture decisions

- **`location` field type**: value `{lat, lng}` (finite, lat ∈ [-90,90], lng ∈ [-180,180], exactly 2 keys). Max one location field per form (new seed-time check). Not in `OPTION_TYPES`/`BOUNDED_TYPES`.
- **List exposure via denormalized columns** — migration `005_request_location.sql`: nullable `request.location_lat/location_lng` (double precision), written once inside `POST /requests` (form_response is immutable, so no sync logic; precedent: TASK.status intentional denormalization). SQL-extraction-per-row rejected (JSONB lateral join in two hot list queries).
- **`GET /requests` list rows gain** `location` + `assignedEmployee {id,name}` (LEFT JOIN task/users) — the web map's only employee representation. `buildRequestFilter` untouched (one query engine rule).
- **`GET /tasks` list rows gain** `location`, guarded: emit only if no location-type field in the request form schema has `visible_to_employee: false` (list feed must not leak what `stripHiddenFields` hides in detail).
- **Data volume**: no new endpoint; map fetches one `pageSize=100` page under current filters, shows "first 100 of N" banner if `total > 100`. Documented limitation.
- **Markers**: colored by status category via the fixed `--cat-*` / `kCategoryColors` palette, always paired with text (Status-Owns-Color rule). Clusters are neutral count circles (mixed categories may not borrow a category color). Web uses `L.divIcon` (also avoids the Leaflet/Vite default-icon bug).
- **Picker UX**: renderer field card ("No location set" / coords + Set/Change/Remove) opening a full-screen `LocationPickerScreen` via an injected `LocationPicker` callback — exact `PhotoUploader` precedent; null callback → disabled placeholder; keeps flutter_map out of widget tests (stub picker). Default center Amman (31.95, 35.91) z12; center on existing value z16. `initialValues` prefill works as-is (unlike photo, location data is reusable).
- **Read-only display**: mobile `FormResponseView` renders coords tappable → `geo:lat,lng?q=…` via url_launcher (OSM web URL fallback; add `geo:` to Android `<queries>` — the tel: release lesson). Web `RequestDetailPane.fieldValue` widened to `ReactNode` + location case → coords + "Open in OpenStreetMap ↗" link.
- **Section 6 permission matrix & Section 7 notification triggers: zero changes** (read-only feature over existing role-guarded payloads).

## Files & changes

**Backend** (`backend/`)
1. `src/lib/formSchema.js` — `'location'` into `FIELD_TYPES`; one-location-per-form check in `validateFieldSchema`.
2. `src/lib/validateFormResponse.js` — pure sync `case 'location'` (shape/bounds/exactly-2-keys; message `` `${label} must be a map location` ``). No db, no photoChecks-style deferral.
3. `migrations/005_request_location.sql` — the two nullable columns.
4. `src/routes/requests.js` — POST: find the form's location-type field, write columns in the same INSERT; list SELECT + `listItem` gain `location`/`assignedEmployee`.
5. `src/routes/tasks.js` — list SELECT joins request form_definition; visibility-guarded `location` in row mapper.
6. `test/validateFormResponse.test.js` — location cases (valid/non-object/missing lng/out-of-range/extra key/string lat/required-optional). New `test/formSchema.test.js` (location accepted; options/min/max forbidden; two location fields rejected).
7. `src/seed.js` — Service A: `{id:'site_location', …, required:false}` (optional — config variance); Service B: `{id:'visit_location', …, required:true}`. **Ids avoid the existing `location` TEXT field (seed.js:46).** `aForm`/`bForm` gain a coords param; Amman-area coords on ~20/22 demo requests, incl. two ~300 m pairs so clustering visibly merges/splits; leave the rejected+cancelled A-requests coordinate-less (null handling demo).

**Mobile** (`mobile/`)
8. `pubspec.yaml` — `flutter_map ^8.3.1`, `latlong2 ^0.10.1`.
9. `lib/forms/form_schema.dart` — `FieldType.location` (enum + `parse()` + `validate()` mirroring the server message).
10. `lib/forms/dynamic_form.dart` — `LocationPicker` typedef + ctor param; `_locationField` card; stores `{'lat':…, 'lng':…}` via `_setValue`.
11. `lib/forms/location_picker_screen.dart` (new) — FlutterMap, tap-to-pin, AppBar confirm; OSM tiles with `userAgentPackageName`.
12. `lib/user/create_request_screen.dart` — wire `locationPicker:` beside `photoUploader:` (~line 128).
13. `lib/widgets/form_response_view.dart` — tappable location row (`geo:` + fallback); `android/.../AndroidManifest.xml` `<queries>` gains `geo:`.
14. `lib/models/task.dart` — `TaskSummary.location` (nullable).
15. `lib/employee/employee_home.dart` + new `lib/employee/task_map_view.dart` — `SegmentedButton` list⇄map by `CategoryChips` (~line 182); pins = active tasks only (category ∉ existing `historyCats` set — no status keys), `kCategoryColors` accents, fit-to-markers, pin tap → bottom sheet (service + StatusPill) → TaskDetail; "N tasks have no location" footer; chips filter in map mode too.
16. `test/dynamic_form_test.dart` — stub-picker tests: card renders, required blocks, picked value in `submit()`, Remove clears, prefill, null-picker placeholder (20 → ~26 green).

**Web** (`web/`)
17. `package.json` — `leaflet ^1.9.4`, `react-leaflet ^5.0.0`, `react-leaflet-cluster ^4.1.3` (verified React-19/RL5-compatible), dev `@types/leaflet`. CSS imported from node_modules — no CDN.
18. `src/pages/RequestsMapView.tsx` (new component, not a route) — MapContainer + cluster group + divIcon markers w/ tooltips (`#id · service · status label · employee`); own 30s-poll fetch of `GET /requests?…&pageSize=100`; >100 banner; marker click → `openDetail(id)` (existing split pane).
19. `src/pages/RequestsPage.tsx` — `view` URL param + list⇄map toggle in the filter bar; **new employee filter select** (URL `employee` → API `employeeId`, copy the `ReportsPage.tsx` pattern, options from `GET /employees`) — applies to list AND map.
20. `src/pages/RequestDetailPane.tsx` — `fieldValue` → `ReactNode`, location case.
21. `src/pages/RequestsPage.css` — marker/cluster/toggle styles on `--cat-*` tokens.

**Docs**
22. `docs/spec_v5_map_amendment.md` — decision record (both students, freeze → Monday), narrow Section 12 reversal, Section 8 type addition, no-new-pages note, matrix/triggers unchanged, 100-row + OSM-internet limitations.
23. `CLAUDE.md` — minimal inline amendment notes on Sections 2, 8, 12 pointing at the doc (v4 precedent).
24. `docs/PROGRESS.md` — slice entries as they land.

## Commit slices (one verified feature per commit, revertible; cut order if Monday slips: 7 → 6 → 5)

| # | Slice | Verify |
|---|---|---|
| 0 | Amendment docs (22–24 decision entry) | both students ack |
| 1 | Backend field type + unit tests (1, 2, 6) | `node --test` green |
| 2 | Migration + exposure (3, 4, 5) | migrate; curl POST w/ & w/o location, list payloads; hidden-field flip negative test (flip back) |
| 3 | Seed (7) | `npm run seed` validators green; both lists show coords |
| 4 | Mobile picker (8–12, 16) | `flutter analyze` + `flutter test`; manual: 422 without required location, 201 with |
| 5 | Mobile read-only display (13) | manual on device: geo: opens maps app |
| 6 | Employee map toggle (14, 15) | manual as cleaner@: pins/filter/tap-through |
| 7 | Monitor web map (17–21) | tsc/lint/build; headless-Edge: toggle, cluster merge/split on zoom, employee filter, marker→pane, URL survives reload |
| 8 | PROGRESS.md final + demo notes | doc-only |

## Verification (end-to-end, fresh seed)

Submit a Home Cleaning request from the user app picking a pin → 201; monitor map shows it clustered near the other Amman pins, splits on zoom, tooltip names the assigned employee after assignment; employee map (cleaner@) shows the task pin, chips filter it, tap opens Task Details, coords tap opens the maps app; Equipment Repair submits fine WITHOUT a location (optional) and shows no pin. Existing suites stay green: backend `node --test`, `flutter test`, web build + existing Playwright checks.

## Risks

OSM tiles need internet on demo day (fallback: list views + Week-8 backup screenshots) · old app builds render `location` as the existing unsupported-type placeholder (graceful degradation, one manual check) · `tel:`-style per-device `geo:` variance — physical-device check before freeze.
