alter table public.eod_reports
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz,
  add column if not exists submitted_at timestamptz;

update public.eod_reports
set period_end = coalesce(period_end, updated_at, created_at, now()),
    period_start = coalesce(period_start, coalesce(updated_at, created_at, now()) - interval '24 hours'),
    submitted_at = coalesce(submitted_at, updated_at, created_at, now())
where period_start is null or period_end is null or submitted_at is null;

alter table public.eod_reports
  alter column period_start set default (now() - interval '24 hours'),
  alter column period_start set not null,
  alter column period_end set default now(),
  alter column period_end set not null,
  alter column submitted_at set default now(),
  alter column submitted_at set not null;

alter table public.eod_reports drop constraint if exists eod_reports_period_check;
alter table public.eod_reports add constraint eod_reports_period_check
  check (period_end > period_start and period_end - period_start <= interval '24 hours 5 minutes');

comment on column public.eod_reports.period_start is 'Inclusive start of the user EOD activity cycle.';
comment on column public.eod_reports.period_end is 'Inclusive end of the user EOD activity cycle.';
comment on column public.eod_reports.submitted_at is 'Latest time the daily EOD report was sent to the superadmin.';
