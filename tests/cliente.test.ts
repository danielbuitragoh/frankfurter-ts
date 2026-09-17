import { describe, it, expect, vi } from 'vitest';
import { ClienteFrankfurter } from '../src/cliente';
import {
  MonedaNoSoportadaError,
  PeticionInvalidaError,
  ServicioNoDisponibleError,
  TiempoAgotadoError,
} from '../src/errores';

/* ------------------------------------------------------------------ */
/* Fixtures: cuerpos y cabeceras REALES, capturados con reconocer-api  */
/* ------------------------------------------------------------------ */

const CACHE_CONTROL_TASAS = 'public, max-age=35504, stale-if-error=86400';

const TASAS_FILTRADAS = [
  { date: '2026-09-16', base: 'EUR', quote: 'COP', rate: 3588.93 },
  { date: '2026-09-16', base: 'EUR', quote: 'USD', rate: 1.155 },
];

const PAR = { date: '2026-09-16', base: 'EUR', quote: 'COP', rate: 3588.93 };

const SERIE = [
  { date: '2026-09-01', base: 'EUR', quote: 'COP', rate: 3702.46 },
  { date: '2026-09-02', base: 'EUR', quote: 'COP', rate: 3671.88 },
  { date: '2026-09-03', base: 'EUR', quote: 'COP', rate: 3651.89 },
];

const MONEDAS = [
  {
    iso_code: 'AED',
    iso_numeric: '784',
    name: 'United Arab Emirates Dirham',
    symbol: 'د.إ',
    start_date: '1996-04-11',
    end_date: '2026-09-16',
  },
];

const ERROR_MONEDA = { status: 422, message: 'invalid currency: ZZZ' };

/** Un fetch falso que devuelve lo que le digamos y cuenta las llamadas. */
function fetchFalso(
  respuestas: Array<{ estado?: number; cuerpo: unknown; cacheControl?: string } | Error>,
) {
  let i = 0;
  const llamadas: string[] = [];

  const fn = vi.fn(async (url: string | URL | Request) => {
    llamadas.push(String(url));
    const r = respuestas[Math.min(i, respuestas.length - 1)];
    i++;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.cuerpo), {
      status: r.estado ?? 200,
      headers: {
        'content-type': 'application/json',
        ...(r.cacheControl ? { 'cache-control': r.cacheControl } : {}),
      },
    });
  });

  // Nada de getters vía Object.assign: copia el VALOR, no el getter, y
  // quedaría congelado en 0. `llamadas` se lee directamente.
  return Object.assign(fn, { llamadas });
}

/* ------------------------------------------------------------------ */

describe('lectura de tasas', () => {
  it('traduce la forma plana de v2 al tipo del paquete', async () => {
    const f = fetchFalso([{ cuerpo: TASAS_FILTRADAS, cacheControl: CACHE_CONTROL_TASAS }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    const tasas = await api.tasas({ base: 'EUR', cotizadas: ['COP', 'USD'] });

    expect(tasas).toEqual([
      { fecha: '2026-09-16', base: 'EUR', cotizada: 'COP', valor: 3588.93 },
      { fecha: '2026-09-16', base: 'EUR', cotizada: 'USD', valor: 1.155 },
    ]);
  });

  it('arma la URL con los parámetros correctos', async () => {
    const f = fetchFalso([{ cuerpo: SERIE }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    await api.tasas({ base: 'eur', cotizadas: ['cop'], desde: '2026-09-01', hasta: '2026-09-10' });

    const url = f.llamadas[0];
    expect(url).toContain('base=EUR');
    expect(url).toContain('quotes=COP');
    expect(url).toContain('from=2026-09-01');
    expect(url).toContain('to=2026-09-10');
  });

  it('un par suelto devuelve un objeto, no un array', async () => {
    const f = fetchFalso([{ cuerpo: PAR }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    expect(await api.tasa('EUR', 'COP')).toEqual({
      fecha: '2026-09-16', base: 'EUR', cotizada: 'COP', valor: 3588.93,
    });
  });

  it('traduce el catálogo de monedas', async () => {
    const f = fetchFalso([{ cuerpo: MONEDAS }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    const [aed] = await api.monedas();
    expect(aed.codigo).toBe('AED');
    expect(aed.nombre).toBe('United Arab Emirates Dirham');
    expect(aed.desde).toBe('1996-04-11');
  });

  it('rechaza combinar fecha con rango', async () => {
    const api = new ClienteFrankfurter({ fetch: fetchFalso([{ cuerpo: [] }]) as never });
    await expect(api.tasas({ fecha: '2026-01-01', desde: '2026-01-01' })).rejects.toThrow(TypeError);
  });
});

describe('caché', () => {
  it('la segunda llamada idéntica no toca la red', async () => {
    const f = fetchFalso([{ cuerpo: TASAS_FILTRADAS, cacheControl: CACHE_CONTROL_TASAS }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    await api.tasas({ cotizadas: ['COP'] });
    await api.tasas({ cotizadas: ['COP'] });

    expect(f.llamadas.length).toBe(1);
  });

  it('parámetros distintos son entradas distintas', async () => {
    const f = fetchFalso([{ cuerpo: TASAS_FILTRADAS, cacheControl: CACHE_CONTROL_TASAS }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    await api.tasas({ cotizadas: ['COP'] });
    await api.tasas({ cotizadas: ['USD'] });

    expect(f.llamadas.length).toBe(2);
  });

  it('con cache:false siempre va a la red', async () => {
    const f = fetchFalso([{ cuerpo: TASAS_FILTRADAS, cacheControl: CACHE_CONTROL_TASAS }]);
    const api = new ClienteFrankfurter({ fetch: f as never, cache: false });

    await api.tasas();
    await api.tasas();

    expect(f.llamadas.length).toBe(2);
  });
});

describe('errores', () => {
  it('una moneda inexistente da MonedaNoSoportadaError y NO se reintenta', async () => {
    const f = fetchFalso([{ estado: 422, cuerpo: ERROR_MONEDA }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    await expect(api.tasas({ base: 'ZZZ' })).rejects.toBeInstanceOf(MonedaNoSoportadaError);
    // Reintentar una moneda que no existe sería castigar al servidor por un
    // error nuestro: una sola llamada.
    expect(f.llamadas.length).toBe(1);
  });

  it('el error de moneda dice cuál era', async () => {
    const f = fetchFalso([{ estado: 422, cuerpo: ERROR_MONEDA }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    await api.tasas({ base: 'ZZZ' }).catch((e) => {
      expect(e).toBeInstanceOf(MonedaNoSoportadaError);
      expect((e as MonedaNoSoportadaError).moneda).toBe('ZZZ');
      expect((e as MonedaNoSoportadaError).estado).toBe(422);
    });
    expect.assertions(3);
  });

  it('un 422 que no es de moneda da PeticionInvalidaError', async () => {
    const f = fetchFalso([{ estado: 422, cuerpo: { status: 422, message: 'invalid date' } }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    await expect(api.tasas({ fecha: 'ayer' })).rejects.toBeInstanceOf(PeticionInvalidaError);
  });

  it('un 500 sí se reintenta y acaba en ServicioNoDisponibleError', async () => {
    const f = fetchFalso([{ estado: 500, cuerpo: { status: 500, message: 'boom' } }]);
    const api = new ClienteFrankfurter({
      fetch: f as never,
      reintentos: { intentos: 3, dormir: async () => {}, aleatorio: () => 1 },
    });

    await expect(api.tasas()).rejects.toBeInstanceOf(ServicioNoDisponibleError);
    expect(f.llamadas.length).toBe(3);
  });

  it('un fallo de red se reintenta y puede acabar bien', async () => {
    const f = fetchFalso([
      new TypeError('fetch failed'),
      { cuerpo: TASAS_FILTRADAS, cacheControl: CACHE_CONTROL_TASAS },
    ]);
    const api = new ClienteFrankfurter({
      fetch: f as never,
      reintentos: { intentos: 3, dormir: async () => {}, aleatorio: () => 1 },
    });

    const tasas = await api.tasas();
    expect(tasas).toHaveLength(2);
    expect(f.llamadas.length).toBe(2);
  });
});

describe('stale-if-error · la razón de ser de la caché', () => {
  it('si la API se cae, sirve la copia caducada y la marca', async () => {
    // Primera llamada buena, con max-age de 1 segundo pero stale-if-error largo.
    const f = fetchFalso([
      { cuerpo: TASAS_FILTRADAS, cacheControl: 'public, max-age=1, stale-if-error=86400' },
      { estado: 503, cuerpo: { status: 503, message: 'caido' } },
    ]);
    const api = new ClienteFrankfurter({
      fetch: f as never,
      reintentos: { intentos: 1 },
    });

    const primera = await api.tasas({ cotizadas: ['COP'] });
    expect(primera[0].caducada).toBeUndefined();

    // Pasa el max-age.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const segunda = await api.tasas({ cotizadas: ['COP'] });
    vi.useRealTimers();

    // El dato sigue siendo bueno —las tasas cambian una vez al día— pero va
    // marcado para que quien lo consume sepa que no acaba de llegar.
    expect(segunda[0].valor).toBe(3588.93);
    expect(segunda[0].caducada).toBe(true);
  });
});

describe('conversión de importes', () => {
  it('convierte con aritmética decimal', async () => {
    const f = fetchFalso([{ cuerpo: PAR, cacheControl: CACHE_CONTROL_TASAS }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    const { origen, destino, tasa } = await api.convertir('100', 'EUR', 'COP');

    expect(origen.aTexto()).toBe('100.00');
    // 100 × 3588,93 = 358 893, y el peso no lleva decimales.
    expect(destino.aTexto()).toBe('358893');
    expect(destino.moneda).toBe('COP');
    expect(tasa.valor).toBe(3588.93);
  });

  it('convertir a la misma moneda no llama a la API', async () => {
    const f = fetchFalso([{ cuerpo: PAR }]);
    const api = new ClienteFrankfurter({ fetch: f as never });

    const { destino } = await api.convertir('50.25', 'EUR', 'EUR');

    expect(destino.aTexto()).toBe('50.25');
    expect(f.llamadas.length).toBe(0);
  });
});

describe('tiempo máximo', () => {
  it('un abort se traduce a TiempoAgotadoError', async () => {
    const abortado = new Error('The operation was aborted');
    abortado.name = 'TimeoutError';
    const f = fetchFalso([abortado]);
    const api = new ClienteFrankfurter({ fetch: f as never, reintentos: { intentos: 1 } });

    await expect(api.tasas()).rejects.toBeInstanceOf(TiempoAgotadoError);
  });
});
