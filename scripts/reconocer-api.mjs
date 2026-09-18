/**
 * Reconocimiento de la API de Frankfurter.
 *
 * Por qué existe: la documentación de frankfurter.dev muestra los comandos
 * curl pero no los cuerpos JSON de respuesta, y desde el entorno donde se
 * escribió el cliente la API está bloqueada por política de red. Antes de
 * fijar los tipos de TypeScript hay que ver las formas REALES, no suponerlas.
 *
 * Uso:   node reconocer-api.mjs
 * Deja:  reconocimiento.json  (pásamelo y cierro los tipos con eso)
 */

import { writeFileSync } from 'node:fs';

const BASE = 'https://api.frankfurter.dev/v2';

const LLAMADAS = [
  ['ultimas',           `${BASE}/rates`],
  ['ultimas_filtradas', `${BASE}/rates?base=EUR&quotes=COP,USD`],
  ['historica',         `${BASE}/rates?date=2026-01-15&base=EUR&quotes=COP`],
  ['serie',             `${BASE}/rates?from=2026-09-01&to=2026-09-10&base=EUR&quotes=COP`],
  ['serie_agrupada',    `${BASE}/rates?from=2026-01-01&to=2026-09-01&group=month&base=EUR&quotes=COP`],
  ['par',               `${BASE}/rate/eur/cop`],
  ['monedas',           `${BASE}/currencies`],
  ['error_moneda',      `${BASE}/rates?base=ZZZ`],
  ['error_fecha',       `${BASE}/rates?date=no-es-fecha`],
];

/** Resume la forma de un valor sin volcar miles de claves. */
function forma(valor, profundidad = 0) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) {
    return valor.length === 0 ? '[]' : [forma(valor[0], profundidad + 1), `… (${valor.length} elementos)`];
  }
  if (typeof valor === 'object') {
    const claves = Object.keys(valor);
    const salida = {};
    // Con muchas claves (el catálogo de monedas, las fechas de una serie) se
    // muestran solo las tres primeras: interesa la forma, no el contenido.
    const muestra = claves.length > 6 && profundidad > 0 ? claves.slice(0, 3) : claves;
    for (const k of muestra) salida[k] = forma(valor[k], profundidad + 1);
    if (muestra.length < claves.length) salida['…'] = `${claves.length} claves en total`;
    return salida;
  }
  return `${typeof valor}  (ej: ${JSON.stringify(valor)})`;
}

const resultado = {};

for (const [nombre, url] of LLAMADAS) {
  process.stdout.write(`→ ${nombre.padEnd(18)} `);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    const texto = await r.text();
    let cuerpo;
    try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto.slice(0, 300); }

    resultado[nombre] = {
      url,
      estado: r.status,
      ms: Date.now() - t0,
      cabeceras: {
        'content-type': r.headers.get('content-type'),
        'cache-control': r.headers.get('cache-control'),
        'access-control-allow-origin': r.headers.get('access-control-allow-origin'),
      },
      forma: forma(cuerpo),
      // Se guarda el cuerpo entero solo si es pequeño, para poder mirarlo.
      cuerpo: texto.length < 1500 ? cuerpo : '(demasiado grande, ver forma)',
    };
    console.log(`${r.status}  ${Date.now() - t0} ms`);
  } catch (e) {
    resultado[nombre] = { url, error: String(e) };
    console.log(`FALLO  ${e.message}`);
  }
}

writeFileSync('reconocimiento.json', JSON.stringify(resultado, null, 2), 'utf8');
console.log('\n✓ Escrito reconocimiento.json — pásamelo y cierro los tipos con las formas reales.');

// La cabecera CORS decide si el panel del proyecto 2 puede llamar a la API
// directamente desde el navegador, sin servidor propio. Es la pieza que
// sostiene que ese proyecto se despliegue como sitio estático.
const cors = resultado.ultimas?.cabeceras?.['access-control-allow-origin'];
console.log(cors === '*'
  ? '✓ CORS abierto: el dashboard podrá llamarla desde el navegador, sin backend.'
  : `⚠ CORS = ${cors ?? 'ausente'} — habría que replantear el proyecto 2.`);
