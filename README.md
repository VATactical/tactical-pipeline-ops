# Tactical Pipeline Ops

Panel interno de VA Tactical construido con React, Vite y Supabase.

## Desarrollo local

1. Copia `.env.example` como `.env`.
2. Agrega la clave publicable de Supabase.
3. Ejecuta `npm install` y `npm run dev`.

## Variables de entorno

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

La app solo usa la clave **publicable** en el navegador. Nunca agregues una clave `secret` o `service_role` a variables que comienzan con `VITE_`.

## Acceso y roles

El registro público no está habilitado en la interfaz. Los usuarios se crean o invitan desde Supabase Auth y reciben inicialmente el rol de menor privilegio.

- `onboarding_media`: Diego
- `automation_funnels`: Daniel
- `superadmin`: Kevin

Las rutas normales exigen una sesión válida. `/equipo` exige `superadmin`. La seguridad de los datos también se aplica en Postgres mediante RLS.

## Despliegue

Configura las dos variables anteriores en Hostinger y usa:

- Build command: `npm run build`
- Output directory: `dist`

Como la app usa `BrowserRouter`, configura el hosting para que las rutas desconocidas sirvan `index.html`.
