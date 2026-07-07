# Spec v5 Amendment — Map Feature (decision record)

**Status: agreed by both students (2026-07-07). Code freeze slips to next Monday to absorb this.** Implementation plan: `docs/map_feature_plan.md`.

## What v5 adds, in one line each

1. A ninth dynamic-form field type, `location` (`{lat, lng}`), picked on a map in the user app.
2. Employee mobile: a list⇄map toggle on My Tasks showing active tasks as pins (employees appear **only** via their tasks — no GPS).
3. Monitor web: a list⇄map toggle on Requests Management with clustered, category-colored, filterable pins; plus an employee filter that applies to both views.

## Scope rules

- **Narrow Section 12 reversal:** only "interactive map pin picker" comes back. **Continuous GPS tracking / route optimization stays removed.**
- **Section 8 addition:** `location` joins the type list; value is exactly `{lat, lng}`, lat ∈ [-90,90], lng ∈ [-180,180]; max one location field per form (seed-time check). Not option-bearing, not bounded.
- **No new pages** (Section 4 unchanged): view-mode toggles inside existing pages + a renderer field widget.
- **Section 6 permission matrix and Section 7 notification triggers: zero changes.** The maps are read-only projections of existing role-guarded list payloads.
- Stack: OpenStreetMap tiles — `flutter_map` (mobile), `react-leaflet` + cluster (web). No API keys, no billing.

## Documented limitations

- Map views render one `pageSize=100` page under the current filters; a "first 100 of N" banner appears when total exceeds it.
- OSM tiles need internet on demo day (fallback: list views + Week-8 backup screenshots).
- Old app builds render `location` as the standard unsupported-type placeholder (graceful degradation).
