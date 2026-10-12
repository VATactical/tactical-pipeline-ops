# Disponibilidad y recuperación de TP | Ops

## Dominios y rutas

La aplicación usa el subdominio `app.tacticalpipeline.com`; el sitio institucional se sirve en `www.tacticalpipeline.com`. Mantén sus registros DNS y destinos de hosting separados. Este proyecto no administra el DNS del dominio y no contiene una fuente de verdad de los registros actuales.

La aplicación usa React Router en el navegador. `public/.htaccess` redirige las rutas que no son archivos a `index.html`, necesario para que una ruta directa como `/login` o `/clientes` funcione al actualizar la página.

## Comprobación básica

Ejecuta desde una terminal con acceso a internet:

```sh
curl -fsS -o /dev/null -w "app login: %{http_code} %{url_effective}\n" https://app.tacticalpipeline.com/login
curl -fsS -o /dev/null -w "app client route: %{http_code} %{url_effective}\n" https://app.tacticalpipeline.com/clientes
curl -fsS -o /dev/null -w "main website: %{http_code} %{url_effective}\n" https://www.tacticalpipeline.com/
```

Las rutas de la app deben responder con la página de la aplicación; la ruta de clientes normalmente requiere autenticación para mostrar datos. Después, inicia sesión para comprobar Auth y carga un cliente. Un `200` por sí solo no valida Supabase, permisos, ni acceso autenticado.

Para aislar DNS del hosting, compara los registros `A`, `AAAA` y `CNAME` de `app` con el destino documentado por el proveedor. Anota los valores actuales y el TTL antes de cambiar nada. No sustituyas los registros de `@` o `www` al reparar `app`.

## Recuperación

1. Comprueba los tres dominios y registra hora, código HTTP y resolución DNS.
2. Si solo fallan rutas internas y `/login` sirve la app, revisa que el hosting mantenga la regla SPA de `public/.htaccess`.
3. Si no responde el subdominio `app`, revisa el último despliegue y restaura el último artefacto conocido como bueno. Comprueba el dominio principal por separado.
4. Si la resolución de `app` cambió, restaura únicamente el registro anterior de `app` desde el historial/exportación del proveedor y espera el TTL. No cambies `@` ni `www` como parte de esa recuperación.
5. Una vez que el HTML vuelva a servir, valida inicio de sesión, lectura del dossier y el webhook de onboarding por separado. Revisa logs de hosting y Supabase Edge Functions para identificar fallos de backend.

No se cambió DNS ni se desplegó esta rama. Desde la herramienta disponible pude confirmar que `www.tacticalpipeline.com` sirve el sitio principal y que contiene un enlace a `app.tacticalpipeline.com`; el lector web no pudo abrir el subdominio de la app ni el dominio raíz. Eso no confirma una caída: el lector puede no tener acceso al sitio. Verifica esos endpoints desde una red normal antes de cambiar DNS.
