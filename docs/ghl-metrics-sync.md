# Sincronización de métricas GHL (Fase 1)

Cada cliente muestra, en la pestaña **ADS**, los leads, leads calificados y citas de su periodo de cobro actual, leídos de su sub-cuenta de GoHighLevel.

## Piezas

- Migración `20261116090000_ghl_metrics_sync.sql`: columnas de ciclo de cobro en `clients`, tabla `client_ghl_metrics` y token privado en `private.client_secrets.ghl_private_token`.
- Edge Function `ghl-metrics-sync`: llama a la API v2 de GHL (`services.leadconnectorhq.com`).
- Componente `GhlMetricsPanel`: configuración y botón **Sincronizar GHL**.

## Qué cuenta

- **Leads**: contactos creados (`dateAdded`) dentro del periodo.
- **Calificados**: esos mismos contactos con la etiqueta configurada (por defecto `qualified`).
- **Citas**: citas de todos los calendarios de la sub-cuenta creadas dentro del periodo; las canceladas se cuentan aparte.
- **Periodo**: desde `billing_cycle_anchor`, en bloques de `billing_cycle_days` (30 por defecto). Sin fecha base se usan los últimos 30 días.

## Conectar un cliente

1. En GHL, entra a la sub-cuenta del cliente → **Settings → Private Integrations → Create new integration**.
2. Permisos: `contacts.readonly`, `calendars.readonly`, `calendars/events.readonly`.
3. Copia el token (`pit-…`). GHL solo lo muestra una vez.
4. En TP Ops → cliente → ADS → **Configurar**: pega el Location ID (Settings → Business Profile), el token (solo Superadmin) y la fecha de inicio del ciclo.
5. Pulsa **Sincronizar GHL**.

## Despliegue

```bash
supabase db push
supabase functions deploy ghl-metrics-sync
```

## Sincronización automática (opcional)

Genera una clave larga, guarda su SHA-256 en `private.integration_webhook_tokens` (`integration_name = 'ghl_metrics_sync'`, `active = true`) y programa un `POST` diario a la función con el encabezado `x-tp-ops-key`. Sin cuerpo, sincroniza todos los clientes conectados.
