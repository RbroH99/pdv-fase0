# Fase 0 — Prueba de accesibilidad desde Cuba

Objetivo: elegir con datos reales el hosting del frontend y del proxy (`docs/01-propuesta-stack.md` §5, ADR-0005), y comprobar de paso los servicios que usaría el portal (YouTube y almacenamiento de archivos, `docs/04-portal-transparencia.md` §7).

Es código **desechable**: no forma parte del sistema y no usa el stack definitivo, pero imita lo que importa medir.

## Qué mide cada ejecución

| Prueba | Para qué decide |
|---|---|
| Carga de la página (HTML, CSS, JS) | ¿El hosting del frontend es accesible y rápido? |
| Descarga de 150 KB sin comprimir | Velocidad real, del orden del JS inicial previsto para la app (ADR-0006) |
| `/api/ping` × 5 **a través del proxy** del mismo origen | ¿Funciona el proxy de ese proveedor desde Cuba y con qué latencia? |
| `/api/ping` × 3 **directo** al backend | Informativo: si el backend también fuera accesible, el proxy sería opcional |
| Imagen de 1 px en **cada** candidato | Accesibilidad cruzada: una sola visita prueba los tres hosts |
| Miniatura de YouTube | Viabilidad del vídeo en YouTube para el portal |
| Imagen en el almacenamiento de objetos (opcional) | Viabilidad de servir archivos desde R2/B2 |
| Recarga con modo avión | Que el service worker funcione en sus dispositivos |

Los resultados se envían a `/api/report` desde una **cola local** que se reintenta al volver la conexión: es el mismo patrón "outbox" del sistema real. También se pueden copiar o enviar por WhatsApp como respaldo. Cada ejecución gasta menos de 0,5 MB.

## Estructura

```
config.json        URLs de la API, candidatos, vídeo de YouTube, imagen de almacenamiento
site/              página de prueba (sin dependencias, compatible con Android antiguos)
api/server.mjs     API mínima: /api/ping, /api/report, /api/reports?key=
build.mjs          genera dist/{render,netlify,cloudflare} con el proxy de cada proveedor
analyze.mjs        resume los informes por proveedor y red
render.yaml        Blueprint de Render (API + sitio estático)
```

## Despliegue (unas 2 horas)

Cuentas de prueba gratuitas, a nombre de alguien que resida fuera de Cuba y con datos reales (R8). No son las cuentas de producción.

1. **API en Render Free**: crear el Blueprint con `render.yaml` (raíz del repo `pdv-fase0`) (crea la API y el sitio de Render). Anotar la URL de la API y el `REPORTS_KEY` generado.
2. Ajustar `config.json`: `apiUrl` y las URLs reales de los tres candidatos (los subdominios pueden no estar disponibles). Opcional: `storageImageUrl` (una imagen pública en R2 o B2) y `whatsappNumber` (formato internacional sin `+`, para recibir los resultados).
3. `node build.mjs`
4. **Render Static**: se publica solo con el Blueprint. Si se configura a mano: Static Site → *Redirects/Rewrites* → `/api/*` → `https://<api>/api/*` → **Rewrite**.
5. **Netlify**: `npx netlify-cli deploy --dir dist/netlify --prod`, o arrastrar `dist/netlify` a app.netlify.com/drop. El proxy está en `_redirects`.
6. **Cloudflare Pages**: `cd dist/cloudflare && npx wrangler pages deploy public --project-name pdv-fase0`. El proxy es la Pages Function de `functions/api/[[path]].js`.
7. Comprobar desde fuera de Cuba que en los tres sitios todas las pruebas salen en verde.
8. Si se cambia `config.json`, hay que reconstruir y **redesplegar los tres**, porque cada sitio sondea a los demás.
9. **Antes de enviar los enlaces**, abrir la URL de la API para despertarla: Render Free se suspende tras 15 min sin uso. La página mide aparte el primer contacto, así que la suspensión no ensucia la latencia.

## Resultados

- `GET https://<api>/api/reports?key=<REPORTS_KEY>` → guardarlo como `reports.json` → `node analyze.mjs reports.json`
- El disco de Render Free es efímero: cada informe también queda en el log como `REPORT {...}`. Si la API se reinicia, se puede exportar el log y ejecutar `node analyze.mjs log.txt`.
- Los resúmenes recibidos por WhatsApp sirven para cruzar datos si algo no llegó.

## Criterio de decisión

Participantes: **al menos 3 coordinadores**, a ser posible de provincias distintas (occidente, centro y oriente), cada uno con **datos móviles y WiFi Nauta**.

Un candidato **aprueba** si:
- La página carga en el **100 %** de las ejecuciones sin VPN.
- El proxy responde en **≥ 95 %** de los pings.
- La mediana de carga es **< 5 s** con datos móviles.
- La prueba sin conexión funciona.

Entre los que aprueben se elige por, en este orden:
1. Latencia del proxy.
2. Velocidad de descarga.
3. Facilidad operativa: despliegue desde CI y cero mantenimiento (R7).

El resultado se registra como ADR ("Proveedor de hosting") y se actualiza `docs/01-propuesta-stack.md` §5.

Si **ningún** candidato aprueba, se prueba un VPS europeo (Hetzner, OVH) sirviendo front y proxy con Caddy. El mismo `dist/render` sirve, añadiendo un `reverse_proxy /api/*`.

## Limpieza

Al terminar, borrar los tres sitios y la API (Render, Netlify y Cloudflare) y los informes. Los informes contienen alias y provincia: son datos personales mínimos y no se conservan más allá de la decisión.
