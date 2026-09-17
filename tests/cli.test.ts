import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { principal } from '../src/cli';
import { ClienteFrankfurter } from '../src/cliente';

const PAR = { date: '2026-09-16', base: 'EUR', quote: 'COP', rate: 3588.93 };
const HISTORICA = [{ date: '2020-03-16', base: 'EUR', quote: 'COP', rate: 4300.11 }];
const MONEDAS = [
  { iso_code: 'COP', iso_numeric: '170', name: 'Colombian Peso', symbol: '$', start_date: '1999-01-04', end_date: '2026-09-16' },
  { iso_code: 'MXN', iso_numeric: '484', name: 'Mexican Peso', symbol: '$', start_date: '1999-01-04', end_date: '2026-09-16' },
  { iso_code: 'JPY', iso_numeric: '392', name: 'Japanese Yen', symbol: '¥', start_date: '1999-01-04', end_date: '2026-09-16' },
];

/** Cliente con la red simulada. */
function apiFalsa(cuerpo: unknown, estado = 200) {
  return new ClienteFrankfurter({
    cache: false,
    reintentos: { intentos: 1 },
    fetch: (async () =>
      new Response(JSON.stringify(cuerpo), {
        status: estado,
        headers: { 'content-type': 'application/json' },
      })) as never,
  });
}

let salida: string[];
let errores: string[];

beforeEach(() => {
  salida = [];
  errores = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { salida.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errores.push(a.join(' ')); });
});
afterEach(() => vi.restoreAllMocks());

const texto = () => salida.join('\n');
const errs = () => errores.join('\n');

describe('ayuda y uso', () => {
  it('sin argumentos muestra la ayuda y sale con 0', async () => {
    expect(await principal([])).toBe(0);
    expect(texto()).toContain('fx <cantidad> <de> <a>');
  });

  it('--help muestra la ayuda', async () => {
    expect(await principal(['--help'])).toBe(0);
    expect(texto()).toContain('Ejemplos');
  });

  it('faltan argumentos → código 2, que es "error de uso"', async () => {
    expect(await principal(['100', 'EUR'])).toBe(2);
    expect(errs()).toContain('Faltan argumentos');
  });

  it('una opción desconocida → código 2', async () => {
    expect(await principal(['--inventada'])).toBe(2);
    expect(errs()).toContain('Opción desconocida');
  });
});

describe('conversión', () => {
  it('convierte y muestra la tasa usada', async () => {
    expect(await principal(['100', 'EUR', 'COP'], apiFalsa(PAR))).toBe(0);
    // 100 × 3588,93 = 358 893, y el peso no lleva decimales
    expect(texto()).toContain('358.893');
    expect(texto()).toContain('1 EUR = 3588.93 COP');
    expect(texto()).toContain('2026-09-16');
  });

  it('acepta minúsculas', async () => {
    expect(await principal(['100', 'eur', 'cop'], apiFalsa(PAR))).toBe(0);
    expect(texto()).toContain('358.893');
  });

  it('--json da salida encadenable, sin adornos', async () => {
    expect(await principal(['100', 'EUR', 'COP', '--json'], apiFalsa(PAR))).toBe(0);
    const d = JSON.parse(texto());
    expect(d).toMatchObject({ cantidad: '100.00', de: 'EUR', resultado: '358893', a: 'COP', tasa: 3588.93 });
  });

  it('--fecha consulta un día concreto', async () => {
    expect(await principal(['100', 'EUR', 'COP', '--fecha', '2020-03-16'], apiFalsa(HISTORICA))).toBe(0);
    expect(texto()).toContain('2020-03-16');
    expect(texto()).toContain('430.011');
  });

  it('--fecha=YYYY-MM-DD también vale', async () => {
    expect(await principal(['100', 'EUR', 'COP', '--fecha=2020-03-16'], apiFalsa(HISTORICA))).toBe(0);
    expect(texto()).toContain('2020-03-16');
  });

  it('una fecha sin datos no revienta: mensaje claro y código 1', async () => {
    expect(await principal(['100', 'EUR', 'COP', '--fecha', '1800-01-01'], apiFalsa([]))).toBe(1);
    expect(errs()).toContain('No hay datos');
  });
});

describe('listado de monedas', () => {
  it('--monedas las lista todas', async () => {
    expect(await principal(['--monedas'], apiFalsa(MONEDAS))).toBe(0);
    expect(texto()).toContain('COP');
    expect(texto()).toContain('Colombian Peso');
    expect(texto()).toContain('3 monedas');
  });

  it('el filtro busca también en el nombre, no solo en el código', async () => {
    expect(await principal(['--monedas', 'peso'], apiFalsa(MONEDAS))).toBe(0);
    expect(texto()).toContain('COP');
    expect(texto()).toContain('MXN');
    expect(texto()).not.toContain('Japanese Yen');
  });

  it('un filtro sin resultados lo dice en vez de callarse', async () => {
    expect(await principal(['--monedas', 'zzz'], apiFalsa(MONEDAS))).toBe(0);
    expect(texto()).toContain('Ninguna moneda coincide');
  });
});

describe('errores, con mensajes que ayudan', () => {
  it('moneda inexistente: dice cuál y cómo listarlas', async () => {
    const api = apiFalsa({ status: 422, message: 'invalid currency: ZZZ' }, 422);
    expect(await principal(['100', 'ZZZ', 'EUR'], api)).toBe(1);
    expect(errs()).toContain('"ZZZ" no es una moneda reconocida');
    expect(errs()).toContain('fx --monedas');
  });

  it('servicio caído: lo explica sin volcar una traza', async () => {
    const api = apiFalsa({ status: 503, message: 'down' }, 503);
    expect(await principal(['100', 'EUR', 'COP'], api)).toBe(1);
    expect(errs()).toContain('no responde');
    expect(errs()).not.toContain('at Object');
  });

  it('una cantidad que no es un número se rechaza antes de nada', async () => {
    expect(await principal(['mucho', 'EUR', 'COP'], apiFalsa(PAR))).toBe(1);
    expect(errs().toLowerCase()).toContain('importe no válido');
  });
});
