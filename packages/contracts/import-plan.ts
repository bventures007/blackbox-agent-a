import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
export const importSelection = z
  .object({
    preset: z.enum([
      "last_30_days",
      "this_year",
      "last_12_months",
      "custom",
      "from_now",
    ]),
    timezone: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return !/^[+-]/.test(value);
        } catch {
          return false;
        }
      }, "invalid_timezone"),
    custom_date: z.iso.date().optional(),
    include_open_items: z.boolean().optional(),
    include_related_records: z.boolean().optional(),
    include_opening_state: z.boolean().optional(),
  })
  .strict();
export function resolveImportSelection(
  input: unknown,
  cutoff = new Date().toISOString(),
) {
  const selection = importSelection.parse(input),
    instant = Temporal.Instant.from(cutoff),
    local = instant.toZonedDateTimeISO(selection.timezone);
  const strict = selection.preset === "from_now";
  if (
    strict &&
    [
      selection.include_open_items,
      selection.include_related_records,
      selection.include_opening_state,
    ].some((x) => x === undefined)
  )
    throw new Error("explicit_context_choice_required");
  let from = instant;
  if (selection.preset === "last_30_days")
    from = instant.subtract({ hours: 30 * 24 });
  if (selection.preset === "this_year")
    from = Temporal.PlainDate.from({ year: local.year, month: 1, day: 1 })
      .toZonedDateTime(selection.timezone)
      .toInstant();
  if (selection.preset === "last_12_months")
    from = local
      .subtract({ months: 12 }, { overflow: "constrain" })
      .toInstant();
  if (selection.preset === "custom") {
    if (!selection.custom_date) throw new Error("custom_date_required");
    const date = Temporal.PlainDate.from(selection.custom_date),
      start = date.toZonedDateTime(selection.timezone);
    if (start.toPlainDate().toString() !== date.toString())
      throw new Error("nonexistent_local_date");
    from = start.toInstant();
  }
  if (Temporal.Instant.compare(from, instant) > 0)
    throw new Error("future_start_date");
  const context = {
    include_open_items: selection.include_open_items ?? true,
    include_related_records: selection.include_related_records ?? true,
    include_opening_state: selection.include_opening_state ?? true,
  };
  return {
    version: 1,
    preset: selection.preset,
    timezone: selection.timezone,
    requested_from: from.toString(),
    initial_cutoff: instant.toString(),
    ...context,
    strict_from_now: strict && !Object.values(context).some(Boolean),
  };
}
