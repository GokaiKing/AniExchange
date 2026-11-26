import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["user", "admin", "superadmin"]);
export const phaseKey = pgEnum("phase_key", [
  "registration",
  "proposals",
  "selection",
  "watching",
  "evidence",
  "reveal",
]);
export const phaseStatus = pgEnum("phase_status", ["pending", "open", "closed"]);
export const dmStatus = pgEnum("dm_status", ["pending", "sent", "failed", "skipped"]);
export const platform = pgEnum("platform", ["mal", "anilist"]);
export const participantStatus = pgEnum("participant_status", [
  "active",
  "withdrawn",
  "no_show",
]);

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Better Auth (user / session / account / verification)
// `user` equivale a la tabla `users` del spec: name = username de Discord,
// image = avatar, más discordId y role como campos adicionales.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Better Auth exige email; con scope `identify` guardamos un placeholder.
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  discordId: text("discord_id").notNull().unique(),
  role: userRole("role").notNull().default("user"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Dominio
// ---------------------------------------------------------------------------

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  paused: boolean("paused").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  adminCanSeePairings: boolean("admin_can_see_pairings").notNull().default(false),
  feedPublic: boolean("feed_public").notNull().default(false),
  drawSeed: text("draw_seed"),
  drawExecutedAt: tstz("draw_executed_at"),
  createdAt: createdAt(),
});

export const eventPhases = pgTable(
  "event_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    key: phaseKey("key").notNull(),
    position: integer("position").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    status: phaseStatus("status").notNull().default("pending"),
    autoAdvance: boolean("auto_advance").notNull().default(true),
    onMiss: text("on_miss"),
    reminderDays: integer("reminder_days")
      .array()
      .notNull()
      .default(sql`'{1}'`),
    executedAt: tstz("executed_at"),
  },
  (t) => [
    unique("event_phases_event_key_unique").on(t.eventId, t.key),
    check("event_phases_ends_after_starts", sql`${t.endsAt} > ${t.startsAt}`),
    index("event_phases_due_idx").on(t.status, t.endsAt),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    platform: platform("platform").notNull(),
    profileUrl: text("profile_url").notNull(),
    profileUsername: text("profile_username").notNull(),
    /** Tope de episodios (13 = 1 cour, 26 = 2 cours); null = indefinido. */
    maxEpisodes: integer("max_episodes"),
    bannedTags: text("banned_tags").array().notNull(),
    allowedTags: text("allowed_tags").array().notNull(),
    allowPtw: boolean("allow_ptw").notNull().default(true),
    status: participantStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("participants_event_user_unique").on(t.eventId, t.userId),
    check("participants_max_episodes_positive", sql`${t.maxEpisodes} > 0`),
    check("participants_banned_tags_max", sql`cardinality(${t.bannedTags}) <= 3`),
    check("participants_allowed_tags_max", sql`cardinality(${t.allowedTags}) <= 5`),
  ],
);

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    giverId: uuid("giver_id")
      .notNull()
      .references(() => participants.id),
    receiverId: uuid("receiver_id")
      .notNull()
      .references(() => participants.id),
    dmStatus: dmStatus("dm_status").notNull().default("pending"),
    dmAttempts: integer("dm_attempts").notNull().default(0),
    dmLastError: text("dm_last_error"),
    dmSentAt: tstz("dm_sent_at"),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => assignments.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("assignments_no_self", sql`${t.giverId} <> ${t.receiverId}`),
    // Únicos solo entre asignaciones vigentes: al repetir el sorteo, las
    // anteriores quedan con superseded_by y no deben chocar.
    uniqueIndex("assignments_active_giver_unique")
      .on(t.eventId, t.giverId)
      .where(sql`${t.supersededBy} is null`),
    uniqueIndex("assignments_active_receiver_unique")
      .on(t.eventId, t.receiverId)
      .where(sql`${t.supersededBy} is null`),
  ],
);

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    anilistId: integer("anilist_id"),
    malId: integer("mal_id"),
    title: text("title").notNull(),
    episodes: integer("episodes"),
    sourceUrl: text("source_url").notNull(),
    coverUrl: text("cover_url"),
    chosen: boolean("chosen").notNull().default(false),
    autoChosen: boolean("auto_chosen").notNull().default(false),
    /** La agregó el sistema (política on_miss random_from_ptw), no el giver. */
    autoAdded: boolean("auto_added").notNull().default(false),
    /** Avisos no bloqueantes al proponer (ya lo vio, está en su PTW, tag poco relevante…). */
    warnings: text("warnings").array().notNull().default(sql`'{}'`),
    /** El receptor marcó preferidos y este anime no tiene ninguno (aviso, no bloquea). */
    missesPreferred: boolean("misses_preferred").notNull().default(false),
    createdAt: createdAt(),
  },
  // Máx. 3 por asignación: se valida en la capa de app dentro de transacción.
  (t) => [
    uniqueIndex("one_chosen_per_assignment")
      .on(t.assignmentId)
      .where(sql`${t.chosen}`),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .unique()
      .references(() => assignments.id, { onDelete: "cascade" }),
    reviewText: text("review_text").notNull(),
    rating: numeric("rating", { precision: 3, scale: 1 }),
    trackerUrl: text("tracker_url"),
    containsSpoilers: boolean("contains_spoilers").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("evidence_rating_range", sql`${t.rating} between 0 and 10`)],
);

/** Imágenes de una review (máx. 4), guardadas en Vercel Blob. */
export const evidenceImages = pgTable(
  "evidence_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    url: text("url").notNull(),
    thumbUrl: text("thumb_url").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("evidence_images_position_unique").on(t.evidenceId, t.position),
    check("evidence_images_position_range", sql`${t.position} between 0 and 3`),
  ],
);

export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id),
    kind: text("kind").notNull(),
    /** Datos para armar el mensaje al enviarlo (assignmentId, fase, conteos…). */
    payload: jsonb("payload").notNull().default({}),
    dedupeKey: text("dedupe_key").notNull().unique(),
    status: dmStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: tstz("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notification_log_status_idx").on(t.status)],
);

/** Límite de peticiones de escritura (spec §16): ventana fija por clave. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: tstz("window_start").notNull(),
  count: integer("count").notNull(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => user.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_at_idx").on(t.createdAt)],
);

export type UserRole = (typeof userRole.enumValues)[number];
export type PhaseKey = (typeof phaseKey.enumValues)[number];
export type PhaseStatus = (typeof phaseStatus.enumValues)[number];
