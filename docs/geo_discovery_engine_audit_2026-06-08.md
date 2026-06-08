# Geo Discovery Engine Audit - 2026-06-08

## Root Cause

The homepage could show far-away stores because the browser path used the rounded public cell endpoint instead of exact GPS coordinates, defaulted to 5km, and contained an automatic radius expansion loop. When an empty response arrived, the hook could move from 5km to larger radii without an explicit user action. The cache key was also grid-based, so users in the same rounded cell could reuse a result computed from a different origin.

## Bugs Found

- Initial local radius was 5km, not the required 3km.
- Supported radii included wider automatic expansion values; required radii are now `3, 5, 10, 15`.
- Browser GPS requests called `/v1/shops/nearby/cell` with rounded `latGrid/lngGrid`, not `/v1/shops/nearby` with exact `latitude/longitude`.
- Private geo cache keys were scoped by grid and radius, not exact coordinates.
- Homepage automatically expanded search radius instead of waiting for the user.
- Returning-user geo cookies could preserve a larger radius and hydrate far-away results on load.
- Coordinate cache TTL was 5 minutes and browser geolocation allowed cached positions.
- Eligibility only checked `APPROVED`, `deleted_at`, and `location`; it did not model inactive, closed, banned, out-of-service, or delivery-radius constraints.
- Optimized `shop_discovery_cards` read model did not carry delivery-radius or ranking inputs.

## Implemented Design

- Strict default search radius is now 3km.
- Radius expansion is explicit: 5km, 10km, and 15km only.
- Browser homepage discovery uses exact GPS coordinates.
- Server-side cell hydration, when enabled, is forced back to 3km and refetched on mount.
- Nearby result cache TTL is 60 seconds.
- Exact-coordinate cache keys include a normalized origin coordinate.
- Cursor signatures bind to exact origin for private GPS requests.
- PostGIS remains the source of truth: `ST_MakePoint(longitude, latitude)` with SRID 4326 and geography-meter `ST_DWithin/ST_Distance`.
- Store eligibility now excludes inactive, closed, banned, deleted, and out-of-service stores; delivery radius is enforced against actual distance.
- Ranking keeps distance as the primary ordering dimension, then applies the weighted score as a tie-breaker.

## Database Migration Plan

1. Apply `20260608170000_strict_geo_radius_engine`.
2. Run Prisma generate.
3. Verify `EXPLAIN (ANALYZE, BUFFERS)` for the nearby SQL uses `idx_merchants_geo`.
4. Backfill merchant rating, order-volume score, and conversion score from analytics jobs.
5. Enable `SHOP_DISCOVERY_CARD_READ_MODEL_ENABLED` only after the read model migration is applied in every environment.

## Latency Target

Target request latency is under 50ms with DB geo lookup under 20ms. The critical path is one indexed PostGIS lookup plus card hydration from L1/L2 cache or the read model. For 1M+ merchants, keep the partial GiST index restricted to eligible stores and keep response limits capped.

## Analytics Dashboard

Grafana dashboard artifact: `docs/geo_discovery_grafana_dashboard.json`.

Required panels:

- Search radius used: `lotzi_geo_search_radius_used_total`
- Stores returned: `lotzi_shops_returned{source="nearby"}`
- Distance distribution: `lotzi_geo_result_distance_km`
- Empty result rate: `lotzi_empty_shop_results_total`
- Geo query latency: `lotzi_geo_query_latency_seconds`
- Full search latency: `lotzi_geo_search_latency_seconds`
- Expansion rate: `lotzi_geo_radius_expansions_total`
- Store click rate and conversion by distance: join client store-click/order events with returned `distanceMeters`

## Operational Checks

- No stores beyond 3km should render while the 3km result set is non-empty.
- Empty 3km results must show the explicit radius controls.
- A 1km store must outrank farther stores because SQL orders by `distance_meters ASC` first.
- `delivery_radius_km * 1000 < distance_meters` stores must not appear.
- Cache keys and cursors must not cross exact origins.
