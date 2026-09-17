#!/usr/bin/env node
/**
 * fx — conversor de divisas desde la terminal.
 *
 *   npx fx 100 EUR COP
 *   npx fx 49.99 eur usd --fecha 2020-03-15
 *   npx fx --monedas
 *
 * Por qué una librería trae también un ejecutable: porque convierte un paquete
 * en algo que se usa, no solo en algo que se importa. Y porque obliga a que la
 * API pública sea cómoda de verdad — si montar el CLI encima resulta incómodo,
 * la librería está mal diseñada.
 *
 * Sin dependencias para parsear argumentos: son cuatro casos y añadir un
 * paquete de terceros para esto haría más pesada la instalación que el propio
 * trabajo que hace.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClienteFrankfurter } from './cliente.js';
import { Dinero } from './dinero.js';
import {
  MonedaNoSoportadaError,
  PeticionInvalidaError,
  ServicioNoDisponibleError,
} from './errores.js';

const AYUDA = `
fx — conversor de divisas (datos de 98 bancos centrales, vía Frankfurter)

  fx <cantidad> <de> <a>          convierte al cambio de hoy
  fx <cantidad> <de> <a> --fecha YYYY-MM-DD
  fx --monedas [filtro]           lista las monedas disponibles
  fx --help

Ejemplos
  fx 100 EUR COP
  fx 49.99 eur usd
  fx 1000 USD EUR --fecha 2020-03-15
  fx --monedas peso

Opciones
  --fecha YYYY-MM-DD   cambio de un día concreto (hay datos desde 1948)
  --sin-cache          fuerza la consulta, ignorando la caché
  --json               salida en JSON, para encadenar con otros comandos
`;

interface Argumentos {
  posicionales: string[];
  fecha?: string;
  sinCache: boolean;
  json: boolean;
  ayuda: boolean;
  monedas: boolean;
}

function parsear(argv: string[]): Argumentos {
  const a: Argumentos = { posicionales: [], sinCache: false, json: false, ayuda: false, monedas: false };

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--help' || t === '-h') a.ayuda = true;
    else if (t === '--monedas' || t === '-m') a.monedas = true;
    else if (t === '--sin-cache') a.sinCache = true;
    else if (t === '--json') a.json = true;
    else if (t === '--fecha') a.fecha = argv[++i];
    else if (t.startsWith('--fecha=')) a.fecha = t.slice(8);
    else if (t.startsWith('-')) throw new Error(`Opción desconocida: ${t}`);
    else a.posicionales.push(t);
  }
  return a;
}

/** Colorea solo si la salida es una terminal — si se redirige a un archivo o
 *  se encadena con otro comando, los códigos de escape estorban. */
const tty = process.stdout.isTTY;
const tenue = (s: string) => (tty ? `[2m${s}[0m` : s);
const fuerte = (s: string) => (tty ? `[1m${s}[0m` : s);

/**
 * @param argv          argumentos, sin `node` ni el nombre del script
 * @param apiInyectada  cliente alternativo. Existe para los tests: sin esto el
 *                      CLI construiría su propio cliente y no habría forma de
 *                      probarlo sin llamar a la API de verdad.
 */
export async function principal(
  argv: string[],
  apiInyectada?: ClienteFrankfurter,
): Promise<number> {
  let args: Argumentos;
  try {
    args = parsear(argv);
  } catch (e) {
    console.error((e as Error).message);
    console.error('Prueba con: fx --help');
    return 2;
  }

  if (args.ayuda || (argv.length === 0)) {
    console.log(AYUDA.trim());
    return 0;
  }

  const api = apiInyectada ?? new ClienteFrankfurter({ cache: !args.sinCache });

  try {
    if (args.monedas) {
      const filtro = args.posicionales[0]?.toLowerCase();
      const lista = (await api.monedas()).filter(
        (m) => !filtro || m.codigo.toLowerCase().includes(filtro) || m.nombre.toLowerCase().includes(filtro),
      );

      if (args.json) {
        console.log(JSON.stringify(lista, null, 2));
      } else if (lista.length === 0) {
        console.log(`Ninguna moneda coincide con "${filtro}".`);
      } else {
        for (const m of lista) console.log(`${fuerte(m.codigo)}  ${m.nombre}`);
        console.log(tenue(`\n${lista.length} monedas`));
      }
      return 0;
    }

    const [cantidad, de, a] = args.posicionales;
    if (!cantidad || !de || !a) {
      console.error('Faltan argumentos. Uso: fx <cantidad> <de> <a>');
      console.error('Prueba con: fx --help');
      return 2;
    }

    // Una fecha concreta no pasa por convertir(), que siempre usa la de hoy.
    const tasa = args.fecha
      ? (await api.tasas({ base: de, cotizadas: [a], fecha: args.fecha }))[0]
      : await api.tasa(de, a);

    if (!tasa) {
      console.error(`No hay datos para ${de.toUpperCase()}→${a.toUpperCase()} en ${args.fecha}.`);
      return 1;
    }

    const origen = Dinero.de(cantidad, de);
    const destino = origen.convertirA(a, String(tasa.valor));

    if (args.json) {
      console.log(JSON.stringify({
        cantidad: origen.aTexto(), de: origen.moneda,
        resultado: destino.aTexto(), a: destino.moneda,
        tasa: tasa.valor, fecha: tasa.fecha,
        ...(tasa.caducada ? { caducada: true } : {}),
      }, null, 2));
      return 0;
    }

    console.log(`${origen.formatear('es-ES')}  →  ${fuerte(destino.formatear('es-ES'))}`);
    console.log(tenue(`1 ${tasa.base} = ${tasa.valor} ${tasa.cotizada} · ${tasa.fecha}`));
    if (tasa.caducada) {
      console.log(tenue('⚠ la API no respondía; este dato viene de la caché'));
    }
    return 0;
  } catch (e) {
    // Cada tipo de error merece un mensaje distinto: decirle "error" a quien se
    // equivocó escribiendo una moneda no le ayuda a arreglarlo.
    if (e instanceof MonedaNoSoportadaError) {
      console.error(`"${e.moneda}" no es una moneda reconocida.`);
      console.error('Lista las disponibles con: fx --monedas');
    } else if (e instanceof PeticionInvalidaError) {
      console.error(e.message);
    } else if (e instanceof ServicioNoDisponibleError) {
      console.error('La API de divisas no responde ahora mismo.');
      console.error(tenue('Se reintentó varias veces antes de rendirse.'));
    } else {
      console.error((e as Error).message ?? String(e));
    }
    return 1;
  }
}

/* Solo se ejecuta al invocarlo como programa, no al importarlo desde un test.
   Se comparan rutas reales resueltas: comparar nombres de archivo sueltos falla
   con enlaces simbólicos, que es exactamente como npm instala los binarios. */
function invocadoDirectamente(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invocadoDirectamente()) {
  principal(process.argv.slice(2)).then((codigo) => { process.exitCode = codigo; });
}
