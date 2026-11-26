import { describe, expect, it } from "vitest";
import { drawPairs, newSeed, seededRandom, shuffle } from "./draw";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p-${String(i).padStart(3, "0")}`);

describe("drawPairs", () => {
  it.each([3, 4, 10, 50])("con %i participantes: todos dan y reciben una vez, nadie se toca", (n) => {
    const people = ids(n);
    const pairs = drawPairs(people, newSeed());

    expect(pairs).toHaveLength(n);
    expect(new Set(pairs.map((p) => p.giverId))).toEqual(new Set(people));
    expect(new Set(pairs.map((p) => p.receiverId))).toEqual(new Set(people));
    expect(pairs.every((p) => p.giverId !== p.receiverId)).toBe(true);

    // Un solo ciclo: siguiendo giver → receiver se recorre a todos antes de volver.
    const next = new Map(pairs.map((p) => [p.giverId, p.receiverId]));
    let current = people[0];
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      current = next.get(current)!;
    }
    expect(seen.size).toBe(n);
  });

  it("misma semilla → mismo resultado, sin importar el orden de entrada", () => {
    const people = ids(20);
    const seed = "semilla-fija";
    expect(drawPairs(people, seed)).toEqual(drawPairs([...people].reverse(), seed));
  });

  it("semillas distintas → resultados distintos", () => {
    const people = ids(20);
    expect(drawPairs(people, "a")).not.toEqual(drawPairs(people, "b"));
  });

  it("rechaza menos de 3 o repetidos", () => {
    expect(() => drawPairs(ids(2), "s")).toThrow(/al menos 3/);
    expect(() => drawPairs(["a", "a", "b"], "s")).toThrow(/repetidos/);
  });
});

describe("shuffle / seededRandom", () => {
  it("es una permutación y no modifica la entrada", () => {
    const input = ids(30);
    const copy = [...input];
    const out = shuffle(input, seededRandom("x"));
    expect(input).toEqual(copy);
    expect([...out].sort()).toEqual(copy);
  });

  it("reparte de forma razonablemente uniforme", () => {
    // Con 3 elementos hay 6 permutaciones; ninguna debería dominar.
    const random = seededRandom("uniformidad");
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const key = shuffle(["a", "b", "c"], random).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });
});
