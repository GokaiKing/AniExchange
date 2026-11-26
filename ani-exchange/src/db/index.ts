import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type Db = ReturnType<typeof createDb>;

function createDb(url: string) {
  // prepare: false → compatible con el pooler de Neon (PgBouncer en modo
  // transacción), que no soporta prepared statements.
  const client = postgres(url, { max: 5, prepare: false });
  return drizzle(client, { schema });
}

// En dev, el HMR reevalúa módulos: guardamos el cliente en globalThis para no
// abrir un pool nuevo en cada recarga.
const globalForDb = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  globalForDb.__db ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.__db;
}

export type Database = Db;
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
