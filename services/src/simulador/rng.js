// Generador pseudoaleatorio con semilla (mulberry32): la misma semilla repite la corrida.
export function crearRng(semilla) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    siguiente,
    entre: (min, max) => min + siguiente() * (max - min),
    entero: (min, max) => Math.floor(min + siguiente() * (max - min + 1)),
    elegir: (lista) => lista[Math.floor(siguiente() * lista.length)],
    /** Elige una clave de un objeto { clave: peso }. */
    ponderado: (pesos) => {
      const total = Object.values(pesos).reduce((s, p) => s + p, 0);
      let r = siguiente() * total;
      for (const [clave, peso] of Object.entries(pesos)) {
        r -= peso;
        if (r < 0) return clave;
      }
      return Object.keys(pesos).at(-1);
    },
  };
}
