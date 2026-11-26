import { cacheLife } from "next/cache";
import { fetchTagCatalog, type TagOption } from "@/lib/anilist";

/** Catálogo de géneros/tags de AniList, cacheado (cambia muy poco). */
export async function getTagCatalog(): Promise<TagOption[]> {
  "use cache";
  cacheLife("days");
  return fetchTagCatalog();
}
