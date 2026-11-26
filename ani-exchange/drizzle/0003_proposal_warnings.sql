ALTER TABLE "proposals" ADD COLUMN "auto_added" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "warnings" text[] DEFAULT '{}' NOT NULL;