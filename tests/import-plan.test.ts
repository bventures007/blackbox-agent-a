import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveImportSelection as resolve } from "../packages/contracts/import-plan.js";
test("30-day import is 720 hours across daylight saving, with a fixed cutoff", () => {
  const p = resolve(
    { preset: "last_30_days", timezone: "Europe/Rome" },
    "2026-03-31T10:15:00Z",
  );
  assert.equal(p.requested_from, "2026-03-01T10:15:00Z");
  assert.equal(p.initial_cutoff, "2026-03-31T10:15:00Z");
  assert.equal(p.include_open_items, true);
});
test("calendar year and 12 months preserve local semantics and clamp leap days", () => {
  assert.equal(
    resolve(
      { preset: "this_year", timezone: "Europe/Rome" },
      "2026-07-17T12:00:00Z",
    ).requested_from,
    "2025-12-31T23:00:00Z",
  );
  assert.equal(
    resolve(
      { preset: "last_12_months", timezone: "America/New_York" },
      "2024-02-29T15:45:00Z",
    ).requested_from,
    "2023-02-28T15:45:00Z",
  );
});
test("custom dates resolve at local midnight and reject future or skipped local dates", () => {
  assert.equal(
    resolve(
      { preset: "custom", timezone: "Europe/Rome", custom_date: "2026-03-29" },
      "2026-04-01T00:00:00Z",
    ).requested_from,
    "2026-03-28T23:00:00Z",
  );
  assert.throws(
    () =>
      resolve(
        { preset: "custom", timezone: "UTC", custom_date: "2027-01-01" },
        "2026-01-01T00:00:00Z",
      ),
    /future_start/,
  );
  assert.throws(
    () =>
      resolve(
        {
          preset: "custom",
          timezone: "Pacific/Apia",
          custom_date: "2011-12-30",
        },
        "2026-01-01T00:00:00Z",
      ),
    /nonexistent_local_date/,
  );
  assert.throws(() =>
    resolve({ preset: "last_30_days", timezone: "invented/zone" }),
  );
});
test("from-now never silently widens into opening or related history", () => {
  assert.throws(
    () => resolve({ preset: "from_now", timezone: "UTC" }),
    /explicit_context_choice_required/,
  );
  const p = resolve(
    {
      preset: "from_now",
      timezone: "Europe/Rome",
      include_open_items: false,
      include_related_records: false,
      include_opening_state: false,
    },
    "2026-10-31T09:00:00Z",
  );
  assert.equal(p.strict_from_now, true);
  assert.equal(p.requested_from, p.initial_cutoff);
  const context = resolve({
    preset: "from_now",
    timezone: "UTC",
    include_open_items: true,
    include_related_records: true,
    include_opening_state: true,
  });
  assert.equal(context.strict_from_now, false);
});
