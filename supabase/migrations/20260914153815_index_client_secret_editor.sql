create index if not exists client_secrets_updated_by_idx
  on private.client_secrets (updated_by);
