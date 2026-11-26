-- Al repetir un sorteo, las asignaciones viejas apuntan (superseded_by) a las
-- nuevas, que se insertan después en la misma transacción. La FK se verifica
-- al hacer commit para permitir ese orden. Drizzle no expresa DEFERRABLE en el
-- schema, por eso es una migración manual.
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_superseded_by_assignments_id_fk";--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_superseded_by_assignments_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."assignments"("id") DEFERRABLE INITIALLY DEFERRED;
