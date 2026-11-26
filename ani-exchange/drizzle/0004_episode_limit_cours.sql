ALTER TABLE "participants" ALTER COLUMN "max_episodes" DROP NOT NULL;--> statement-breakpoint
-- Límites por cours: los presets viejos (12/24) pasan a 1 cour (13) / 2 cours (26).
UPDATE "participants" SET "max_episodes" = 13 WHERE "max_episodes" = 12;--> statement-breakpoint
UPDATE "participants" SET "max_episodes" = 26 WHERE "max_episodes" = 24;
