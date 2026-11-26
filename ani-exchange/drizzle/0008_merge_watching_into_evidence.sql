-- "Ver la serie" y "Evidencia" pasan a ser una sola fase ("evidence"), para que
-- cada quien suba su review en cuanto termine. En ediciones existentes, la fase
-- de evidencia hereda el inicio de "watching" (si estaba habilitada y empezaba
-- antes) y la fila de "watching" se elimina. El valor 'watching' se queda en el
-- enum phase_key sin uso (Postgres no permite quitarlo fácilmente).
UPDATE "event_phases" AS e
SET "starts_at" = w."starts_at"
FROM "event_phases" AS w
WHERE w."event_id" = e."event_id"
  AND w."key" = 'watching'
  AND e."key" = 'evidence'
  AND w."enabled"
  AND w."starts_at" < e."starts_at";--> statement-breakpoint
DELETE FROM "event_phases" WHERE "key" = 'watching';--> statement-breakpoint
UPDATE "event_phases" SET "position" = "position" - 1 WHERE "key" IN ('evidence', 'reveal');
