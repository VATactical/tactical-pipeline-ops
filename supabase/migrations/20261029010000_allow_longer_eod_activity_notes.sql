alter table public.time_entries
  drop constraint if exists time_entries_memo_check;

alter table public.time_entries
  add constraint time_entries_memo_check
  check (char_length(btrim(memo)) between 1 and 2200) not valid;

alter table public.time_entries
  validate constraint time_entries_memo_check;
