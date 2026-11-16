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

## Periodos e historial

- **Ciclo actual**: lo que se guarda en cada sincronización.
- **Ciclos anteriores**: el botón *Traer historial (6 ciclos)* guarda los 6 ciclos previos (`{ clientId, history: 6 }`). Requiere la fecha de inicio del ciclo y nunca va antes de ella.
- **Rango de fechas**: consulta en vivo (`{ clientId, from, to }`, máximo un año); no se guarda.
- **Reportes ADS**: *Traer leads y citas de GHL* usa el mismo rango en vivo con las fechas del reporte.

## Sincronización automática

Migración `20261116220000_ghl_metrics_daily_sync.sql`: `pg_cron` llama a la función todos los días a las 11:00 UTC (6:00 a. m. ET en invierno, 7:00 a. m. en horario de verano) y sincroniza el ciclo actual de todos los clientes conectados. La clave del programador se genera dentro de la base de datos y vive en Vault (`ghl_metrics_sync_key`); la tabla de tokens solo guarda su SHA-256.

- Ver ejecuciones: `select * from cron.job_run_details order by start_time desc limit 5;`
- Ver respuesta de la función: `select status_code, content from net._http_response order by created desc limit 5;`
- Lanzar una sincronización completa a mano: `select private.run_ghl_metrics_sync();`

El botón **Sincronizar GHL** sigue disponible para actualizar un cliente al momento.
