/**
 * Sorteo (spec §9): permutación de ciclo único con semilla reproducible.
 * Funciones puras, sin base de datos.
 */
import { createHash, randomBytes } from "node:crypto";

export const MIN_PARTICIPANTS = 3;

/** Semilla nueva: 32 bytes aleatorios en hex. */
export function newSeed(): string {
  return randomBytes(32).toString("hex");
}

/**
 * PRNG determinista (sfc32) inicializado con SHA-256 de la semilla.
 * Devuelve floats en [0, 1).
 */
export function seededRandom(seed: string): () => number {
  const hash = createHash("sha256").update(seed).digest();
  let a = hash.readUInt32LE(0);
  let b = hash.readUInt32LE(4);
  let c = hash.readUInt32LE(8);
  let d = hash.readUInt32LE(12);
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Descarta las primeras salidas para mezclar bien el estado inicial.
  for (let i = 0; i < 16; i++) next();
  return next;
}

/** Fisher–Yates con el PRNG dado. No modifica el arreglo original. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export type Pair = { giverId: string; receiverId: string };

/**
 * Empareja en un solo ciclo: tras mezclar, cada persona le da a la siguiente
 * y la última a la primera. Todos dan una vez, reciben una vez y nadie se toca
 * a sí mismo. Los IDs se ordenan antes de mezclar para que el resultado
 * dependa solo de la semilla y del conjunto de participantes.
 */
export function drawPairs(participantIds: readonly string[], seed: string): Pair[] {
  if (new Set(participantIds).size !== participantIds.length) {
    throw new Error("Hay participantes repetidos");
  }
  if (participantIds.length < MIN_PARTICIPANTS) {
    throw new Error(`Se necesitan al menos ${MIN_PARTICIPANTS} participantes`);
  }
  const order = shuffle([...participantIds].sort(), seededRandom(seed));
  return order.map((giverId, i) => ({ giverId, receiverId: order[(i + 1) % order.length] }));
}
