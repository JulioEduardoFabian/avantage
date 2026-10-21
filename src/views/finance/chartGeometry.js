/**
 * La geometría del gráfico de Flujo de Fondos: la escala del eje y la curva.
 *
 * Son las dos cosas del gráfico que pueden decir algo falso, así que viven
 * aparte de la vista y se prueban: un eje con cifras raras no se lee, y una
 * curva que se pasa de los datos dibuja plata que no existe.
 */

/**
 * El techo del eje, redondeado a una cifra "limpia" (1 · 1.25 · 1.5 · 2 · 2.5 ·
 * 3 · 4 · 5 · 6 · 8 × 10ⁿ).
 *
 * Con el máximo real multiplicado por 1.15 el eje decía "S/ 22.5k · 14.9k ·
 * 7.4k": números que nadie usa para estimar de un vistazo, que es para lo
 * único que sirve un eje. Redondeando hacia arriba, las cuatro marcas caen en
 * cuartos legibles.
 */
export function niceAxisMax(value) {
  const bruto = Math.max(Number(value) || 0, 1);
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const normalizado = bruto / magnitud;
  const paso = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => normalizado <= n) ?? 10;
  return paso * magnitud;
}

/**
 * Curva suave que NO se pasa de los datos (interpolación monótona de
 * Fritsch–Carlson).
 *
 * La spline anterior (Catmull-Rom) inventaba: entre un mes en cero y el
 * siguiente, la curva de ingresos se hundía por DEBAJO del eje —dibujando
 * ingresos negativos que no existen— y se disparaba por encima del pico del
 * mejor mes. Una curva que exagera el pico y muestra plata negativa no es un
 * detalle estético: es el gráfico diciendo algo distinto de la tabla.
 *
 * Esta acota las tangentes para que cada tramo se quede entre los dos valores
 * que une. Se sigue leyendo redondeada; simplemente no inventa.
 */
export function monotonePath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const n = points.length;
  const dx = [];
  const pendiente = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    pendiente[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
  }

  // Tangente en cada punto: CERO en los extremos locales —ahí es justamente
  // donde la curva se pasaba— y el promedio ponderado en el resto.
  const m = new Array(n);
  m[0] = pendiente[0];
  m[n - 1] = pendiente[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (pendiente[i - 1] * pendiente[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / pendiente[i - 1] + w2 / pendiente[i]);
    }
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const t = dx[i] / 3;
    d += ` C ${(points[i].x + t).toFixed(1)} ${(points[i].y + m[i] * t).toFixed(1)},`
      + ` ${(points[i + 1].x - t).toFixed(1)} ${(points[i + 1].y - m[i + 1] * t).toFixed(1)},`
      + ` ${points[i + 1].x.toFixed(1)} ${points[i + 1].y.toFixed(1)}`;
  }
  return d;
}

/**
 * El valor mínimo y máximo que alcanza una curva cúbica, muestreándola. Lo usa
 * la prueba para verificar que la curva no se sale del rango de sus puntos —
 * que es la única forma de comprobar que no inventa.
 */
export function sampleCurveRange(path) {
  const numeros = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numeros.length < 8) return { min: 0, max: 0 };

  let min = Infinity;
  let max = -Infinity;
  let x0 = numeros[0];
  let y0 = numeros[1];
  for (let i = 2; i + 5 < numeros.length; i += 6) {
    const [x1, y1, x2, y2, x3, y3] = numeros.slice(i, i + 6);
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const u = 1 - t;
      const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    x0 = x3;
    y0 = y3;
  }
  return { min, max };
}
