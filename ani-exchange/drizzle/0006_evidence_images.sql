CREATE TABLE "evidence_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	"thumb_url" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_images_position_unique" UNIQUE("evidence_id","position"),
	CONSTRAINT "evidence_images_position_range" CHECK ("evidence_images"."position" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "evidence_images" ADD CONSTRAINT "evidence_images_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;