-- Adds an explicit, nullable verification flag for Google Business Profile access.
-- NULL = not verified yet; TRUE = access confirmed; FALSE = access is not available.
-- Additive only: existing GBP listing status and client data remain unchanged.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS gbp_access_confirmed boolean;

COMMENT ON COLUMN public.clients.gbp_access_confirmed IS
  'Whether the team has confirmed access to the client Google Business Profile. NULL means not verified.';
