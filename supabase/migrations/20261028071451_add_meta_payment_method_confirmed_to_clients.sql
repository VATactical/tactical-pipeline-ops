-- Keep existing client records unclassified until the Meta payment method is checked.
alter table public.clients
  add column if not exists meta_payment_method_confirmed boolean;

comment on column public.clients.meta_payment_method_confirmed is
  'Whether a payment method is confirmed on the client Meta ad account. NULL means pending verification.';
