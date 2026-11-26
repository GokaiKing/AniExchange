# Intercambio de Anime

Sitio para el intercambio anual de anime del grupo de Discord. Next.js 16 + Drizzle (Postgres) + Better Auth (Discord).

## Setup local

1. `npm install`
2. Postgres local con dos bases: `aniexchange` (dev) y `aniexchange_test` (pruebas).
3. `cp .env.example .env.local` y llenar:
   - `AUTH_SECRET`: `openssl rand -base64 32`
   - `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`: app en <https://discord.com/developers/applications>, OAuth2 → Redirects → `http://localhost:3000/api/auth/callback/discord`
   - `SUPERADMIN_DISCORD_IDS`: tu Discord ID (Modo desarrollador → clic derecho en tu usuario → Copiar ID)
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

Las pruebas de integración usan `TEST_DATABASE_URL` (una base cuyo nombre termine en `_test`; se trunca en cada prueba). Para prepararla: `DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate`. Si no está definida, esas pruebas se saltan.

## Notas

- Login con Discord solo con scope `identify`. Better Auth exige un email, así que se guarda un placeholder `<discordId>@discord.invalid`.
- Todas las fechas se guardan en UTC y se interpretan en `America/Hermosillo`.
- `cacheComponents` está activo: cualquier componente que lea sesión, cookies o `searchParams` va dentro de `<Suspense>`.
