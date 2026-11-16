# Migraciones no registradas en producción

Estos archivos estaban en `supabase/migrations/` pero **no aparecen** en el historial de
migraciones de producción (`supabase_migrations.schema_migrations`). Sus efectos (tablas,
columnas y funciones como `client_audit_log`, `client_offer_history`,
`reserve_next_client_code` o `profiles.last_task_seen_at`) sí existen en producción, así que
se aplicaron por otra vía (SQL editor o una migración con otro nombre).

Se movieron aquí para que `supabase db push` no intente ejecutarlos otra vez: varios
insertan datos de respaldo y podrían duplicar filas.

`supabase/migrations/` ahora coincide exactamente con el historial de producción.

## Pendiente

Para poder reconstruir la base de datos desde cero con fidelidad, genera una línea base
con la CLI de Supabase (`supabase db dump --schema public,private`) y guárdala como
migración inicial. Después de eso, esta carpeta se puede eliminar.
