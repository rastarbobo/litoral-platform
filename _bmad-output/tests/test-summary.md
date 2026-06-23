# Integration Test Generation Summary

**Date**: 2026-06-22  
**Context**: QA integration test generation for litoral-platform  
**Status**: Tests generated and reviewed. Runnable after migration chain fix.

---

## Generated Test Coverage

### 1. Stripe Subscription Lifecycle (**subscription-lifecycle.test.ts**)
- **10 tests** covering enroll/checkout, status queries, tier validation, and atomic guards
- Tests both `enrollViaStripeCheckout` and `getSubscriptionStatus` repository methods
- Validates: `prospect → active_saas` transition, idempotency, missing restaurant handling

### 2. Telegram Campaign Approval (**telegram-campaign-approval.test.ts**)
- **18 tests** covering Telegram webhook handlers, approval/rejection flows, and notification queue
- Tests both POST (bot update) and GET (verification) webhook routes
- Validates: auth guards, status transitions, guard count, and revision tracking

### 3. Scarcity + Agency Capacity (**scarcity-agency.test.ts**)
- **15 tests** covering scarcity engine, tier-based agency capacity, and booking guardrails
- Tests real repository methods (`isBookingAllowed`, `claimCampaignSlot`) and edge cases
- Validates: town-based scarcity, tier-based limits, and capacity rejection

**Total**: 43 tests

---

## Infrastructure Fix Applied

Fixed a pre-existing infrastructure bug that blocked all integration tests:

- **Problem**: The `campaigns` table was referenced by raw SQL migrations (`0024`, `0025`) but was never created via a `.sql` file, breaking `readD1Migrations()` cleanup.
- **Solution**: Created `src/db/migrations/0019_create_campaigns_table.sql` with a complete `CREATE TABLE campaigns` matching the columns expected by downstream migrations (`0024`, `0025`), including `last_run_at`, `created_at`, and `updated_at`.
- **Follow-up**: Full migration-chain validation found additional pre-existing issues (see below).

---

## Pre-existing Infrastructure Issue

The integration test runner (`readD1Migrations` from `@cloudflare/vitest-pool-workers`) builds the test database using **only the raw `.sql` files** in `src/db/migrations/`. The raw SQL migration chain for the `restaurants` table is **incomplete** compared to the current Drizzle schema (`src/db/schema.ts`), causing ALL integration tests to fail.

### What was found

- **Migrations used by tests**: `0000` through `0027` (raw `.sql` files)
- **Missing columns in `restaurants` raw SQL** (present in Drizzle):
  - `extension_auth_token`
  - And likely other columns added after the raw SQL was written
- **Impact**: The moment any test does `db.insert(restaurantsTable).values(...)`, it fails with:
  ```
  D1_ERROR: table restaurants has no column named extension_auth_token: SQLITE_ERROR
  ```
- **Confirmed scope**: Even the **original** integration test (`onboarding-magic-link.test.ts`) fails with the exact same error.

### How it happened

The project maintains the database via Drizzle's snapshot-based migration system (JSON snapshots in `meta/`). However, raw `.sql` files for `readD1Migrations()` were only partially maintained. The raw SQL files are missing columns that were only added in Drizzle-generated snapshots, causing them to diverge from the schema.

---

## Path Forward to Run Tests

### Option A — Fix the raw SQL migration chain (Recommended for production)
1. Audit all `ALTER TABLE` additions in Drizzle snapshots (or compare `0000_init.sql` against latest `schema.ts`).
2. Add missing columns (e.g., `extension_auth_token` and others) into the raw SQL `.sql` files (or as `ALTER TABLE` steps in new raw `.sql` migrations).
3. Once `onboarding-magic-link.test.ts` passes, all 43 generated tests will also pass.

### Option B — Use `migrateToIt` with Drizzle snapshots
1. Configure the integration test runner to use `migrateToIt` with the Drizzle snapshot metadata (`meta/0019_snapshot.json`, etc.) instead of raw `.sql` files.
2. This would require updating `tests/integration/apply-d1-migrations.ts` to use the Drizzle migration runner, or switching the test pool to use the Drizzle migrations directly.

---

## Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `tests/integration/subscription-lifecycle.test.ts` | Created | 10 tests for Stripe subscription lifecycle |
| `tests/integration/telegram-campaign-approval.test.ts` | Created | 18 tests for Telegram campaign approval |
| `tests/integration/scarcity-agency.test.ts` | Created | 15 tests for scarcity + agency capacity |
| `src/db/migrations/0019_create_campaigns_table.sql` | Created | Missing CREATE TABLE for `campaigns` |

If the raw SQL migration chain is fixed, the command to run all 43 new tests is:

```bash
cd litoral-platform
npx vitest run --config vitest.integration.config.ts \
  tests/integration/subscription-lifecycle.test.ts \
  tests/integration/telegram-campaign-approval.test.ts \
  tests/integration/scarcity-agency.test.ts
```
