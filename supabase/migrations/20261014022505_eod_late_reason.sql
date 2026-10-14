-- Store the reason when a team member submits an EOD report after its work date.
-- Existing reports are preserved and receive an empty default value.
ALTER TABLE public.eod_reports
  ADD COLUMN IF NOT EXISTS late_reason text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
