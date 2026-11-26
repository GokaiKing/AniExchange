ALTER TABLE "participants" DROP CONSTRAINT "participants_banned_tags_max";--> statement-breakpoint
ALTER TABLE "participants" DROP CONSTRAINT "participants_allowed_tags_max";--> statement-breakpoint
-- Límites de tags al revés de como estaban: 5 permitidos y 3 baneados.
-- Si alguien ya tenía más de 3 baneados, se conservan los primeros 3.
UPDATE "participants" SET "banned_tags" = "banned_tags"[1:3] WHERE cardinality("banned_tags") > 3;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_banned_tags_max" CHECK (cardinality("participants"."banned_tags") <= 3);--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_allowed_tags_max" CHECK (cardinality("participants"."allowed_tags") <= 5);