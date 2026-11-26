/** Servicios externos de anime, inyectables para pruebas. */
import {
  type AnimeRef,
  fetchMedia,
  fetchPlanToWatch,
  type ListStatus,
  listStatusFor,
  type Media,
} from "@/lib/anime";
import type { Platform } from "@/lib/profiles";

export type AnimeServices = {
  fetchMedia: (ref: AnimeRef) => Promise<Media | null>;
  listStatus: (platform: Platform, username: string, media: Media) => Promise<ListStatus | null>;
  planToWatch: (platform: Platform, username: string) => Promise<AnimeRef[]>;
};

export const defaultAnimeServices: AnimeServices = {
  fetchMedia: (ref) => fetchMedia(ref),
  listStatus: (platform, username, media) => listStatusFor(platform, username, media),
  planToWatch: (platform, username) => fetchPlanToWatch(platform, username),
};
