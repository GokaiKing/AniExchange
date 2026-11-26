/** Acceso a Vercel Blob, inyectable para pruebas. */
import { BlobNotFoundError, del, head, list } from "@vercel/blob";
import { getEnv } from "@/lib/env";

export type BlobStore = {
  /** ¿Existe? Devuelve content-type y tamaño, o null. */
  head: (url: string) => Promise<{ contentType: string; size: number } | null>;
  del: (urls: string[]) => Promise<void>;
  /** Blobs bajo un prefijo, con fecha de subida (para limpiar huérfanos). */
  list: (prefix: string) => Promise<{ url: string; uploadedAt: Date }[]>;
};

export function isBlobConfigured(): boolean {
  return Boolean(getEnv().BLOB_READ_WRITE_TOKEN);
}

export function vercelBlobStore(): BlobStore {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  return {
    head: async (url) => {
      try {
        const result = await head(url, { token });
        return { contentType: result.contentType, size: result.size };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
    del: async (urls) => {
      if (urls.length > 0) await del(urls, { token });
    },
    list: async (prefix) => {
      const blobs: { url: string; uploadedAt: Date }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000, token });
        blobs.push(...page.blobs.map((b) => ({ url: b.url, uploadedAt: b.uploadedAt })));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return blobs;
    },
  };
}
