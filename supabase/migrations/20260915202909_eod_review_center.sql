create table if not exists public.eod_report_reviews (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.eod_reports(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  status text not null default 'Visto'
    check (status in ('Visto', 'Revisado', 'Requiere seguimiento')),
  viewed_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (report_id, reviewer_id)
);

create index if not exists eod_report_reviews_reviewer_id_idx
  on public.eod_report_reviews(reviewer_id);
create index if not exists eod_report_reviews_report_id_idx
  on public.eod_report_reviews(report_id);

alter table public.eod_report_reviews enable row level security;
grant select, insert, update, delete on public.eod_report_reviews to authenticated;
grant usage, select on sequence public.eod_report_reviews_id_seq to authenticated;

drop policy if exists "Operations admins read EOD reviews" on public.eod_report_reviews;
create policy "Operations admins read EOD reviews"
on public.eod_report_reviews for select to authenticated
using ((select private.has_permission('operations_admin')));

drop policy if exists "Reviewers create own EOD reviews" on public.eod_report_reviews;
create policy "Reviewers create own EOD reviews"
on public.eod_report_reviews for insert to authenticated
with check (
  reviewer_id = (select auth.uid())
  and (select private.has_permission('operations_admin'))
);

drop policy if exists "Reviewers update own EOD reviews" on public.eod_report_reviews;
create policy "Reviewers update own EOD reviews"
on public.eod_report_reviews for update to authenticated
using (
  reviewer_id = (select auth.uid())
  and (select private.has_permission('operations_admin'))
)
with check (
  reviewer_id = (select auth.uid())
  and (select private.has_permission('operations_admin'))
);

drop policy if exists "Reviewers delete own EOD reviews" on public.eod_report_reviews;
create policy "Reviewers delete own EOD reviews"
on public.eod_report_reviews for delete to authenticated
using (
  reviewer_id = (select auth.uid())
  and (select private.has_permission('operations_admin'))
);

create table if not exists public.eod_report_comments (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.eod_reports(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  task_id text references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eod_report_comments_report_id_idx
  on public.eod_report_comments(report_id);
create index if not exists eod_report_comments_author_id_idx
  on public.eod_report_comments(author_id);
create index if not exists eod_report_comments_task_id_idx
  on public.eod_report_comments(task_id);

alter table public.eod_report_comments enable row level security;
grant select, insert, update, delete on public.eod_report_comments to authenticated;
grant usage, select on sequence public.eod_report_comments_id_seq to authenticated;

drop policy if exists "Supervisors and report owners read EOD comments" on public.eod_report_comments;
create policy "Supervisors and report owners read EOD comments"
on public.eod_report_comments for select to authenticated
using (
  (select private.has_permission('operations_admin'))
  or exists (
    select 1 from public.eod_reports r
    where r.id = report_id and r.user_id = (select auth.uid())
  )
);

drop policy if exists "Operations admins create EOD comments" on public.eod_report_comments;
create policy "Operations admins create EOD comments"
on public.eod_report_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.has_permission('operations_admin'))
);

drop policy if exists "Authors update EOD comments" on public.eod_report_comments;
create policy "Authors update EOD comments"
on public.eod_report_comments for update to authenticated
using (
  author_id = (select auth.uid())
  and (select private.has_permission('operations_admin'))
)
with check (
  author_id = (select auth.uid())
  and (select private.has_permission('operations_admin'))
);

drop policy if exists "Authors delete EOD comments" on public.eod_report_comments;
create policy "Authors delete EOD comments"
on public.eod_report_comments for delete to authenticated
using (
  author_id = (select auth.uid())
  and (select private.has_permission('operations_admin'))
);
