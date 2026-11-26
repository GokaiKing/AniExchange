# AniExchange

Sitio para el intercambio anual de anime del grupo de Discord. Next.js 16 + Drizzle (Postgres) + Better Auth (Discord) + Vercel Blob.

Flujo: inscripción → sorteo automático → DM de asignación → el giver propone hasta 3 animes → el receptor elige uno → lo ve → sube su review → reveal.

## Setup local

1. `npm install`
2. Postgres local con dos bases: `aniexchange` (dev) y `aniexchange_test` (pruebas).
3. `cp .env.example .env.local` y llenar:
   - `AUTH_SECRET`: `openssl rand -base64 32`
   - `CRON_SECRET`: `openssl rand -hex 24`
   - `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`: app en <https://discord.com/developers/applications>, OAuth2 → Redirects → `http://localhost:3000/api/auth/callback/discord`
   - `DISCORD_BOT_TOKEN`: misma app → Bot → Reset Token (opcional en local; sin él los DMs se quedan en cola)
   - `SUPERADMIN_DISCORD_IDS`: tu Discord ID (Modo desarrollador → clic derecho en tu usuario → Copiar ID)
   - `BLOB_READ_WRITE_TOKEN`: opcional; sin él se ocultan las imágenes en reviews
4. `npm run db:migrate`
5. `npm run dev`

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm test` | Pruebas (Vitest) |
| `npm run typecheck` / `npm run lint` | Chequeos estáticos |
| `npm run db:generate` | Genera una migración a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migraciones pendientes |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Crea una edición de ejemplo del año actual (si no existe) |
| `npm run db:seed:test` | **Solo local.** Inscribe participantes de prueba (`-- --draw` para además sortear) |
| `npm run dm:test` | Manda un DM de prueba a los superadmins para verificar el bot |

Las pruebas de integración usan `TEST_DATABASE_URL` (una base cuyo nombre termine en `_test`; se trunca en cada prueba). Para prepararla: `DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate`. Si no está definida, esas pruebas se saltan.

## Despliegue (Vercel Hobby + Neon)

1. **Base de datos (Neon):** crea un proyecto y copia dos cadenas de conexión: la **pooled** (host con `-pooler`) para la app y la **directa** para migraciones. Aplica las migraciones con la directa:
   ```bash
   DATABASE_URL="postgres://…directa…?sslmode=require" npm run db:migrate
   ```
2. **Proyecto en Vercel:** importa el repo con **Root Directory = `ani-exchange`**.
3. **Variables de entorno** (Production): `DATABASE_URL` (la pooled), `AUTH_SECRET`, `CRON_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `SUPERADMIN_DISCORD_IDS`, `APP_TIMEZONE=America/Hermosillo` y `APP_BASE_URL=https://tu-dominio`. Usa secretos nuevos para producción, no los de local.
4. **Blob:** Storage → crea un Blob store con acceso **Public** y conéctalo al proyecto (agrega `BLOB_READ_WRITE_TOKEN` solo).
5. **Discord:** en OAuth2 → Redirects agrega `https://tu-dominio/api/auth/callback/discord`. Invita el bot al servidor del intercambio: `https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot&permissions=0&integration_type=0`.
6. **Crons:**
   - `vercel.json` ya trae uno diario a las 07:05 UTC (00:05 Hermosillo; en Hobby puede correr hasta 59 min después). Hace un tick de respaldo y la limpieza diaria (imágenes huérfanas, rate limits).
   - Hobby **no permite crons más frecuentes que diarios**. Para los DMs en lotes y recordatorios, configura un cron externo (p. ej. <https://cron-job.org>) cada 15 min:
     `POST https://tu-dominio/api/cron/tick` con header `Authorization: Bearer <CRON_SECRET>`.
   - Las fases abren y cierran a tiempo aunque no corra el cron: el sitio lo evalúa al visitarse.
7. **Verificación:** entra con Discord (tu ID debe salir como superadmin), crea la edición en el panel y corre `npm run dm:test` apuntando a producción (o usa "Enviar DMs pendientes ahora" en el panel).

## Notas

- Login con Discord solo con scope `identify`. Better Auth exige un email, así que se guarda un placeholder `<discordId>@discord.invalid`. Los tokens de Discord se guardan cifrados con `AUTH_SECRET`: si lo cambias, todos tendrán que volver a iniciar sesión.
- Todas las fechas se guardan en UTC y se interpretan en `America/Hermosillo` (en la UI: "horario del vendehumo del admin").
- `cacheComponents` está activo: cualquier componente que lea sesión, cookies o `searchParams` va dentro de `<Suspense>`.
- En dev la caché en disco de Turbopack está desactivada (`turbopackFileSystemCacheForDev: false`) porque llegaba a servir CSS viejo.
- La música de fondo (`public/bgm/bgm.mp3`) arranca con el primer clic/tecla y sigue al navegar entre pantallas.
