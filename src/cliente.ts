/**
 * Cliente de la API de Frankfurter v2.
 *
 * https://api.frankfurter.dev/v2 — sin clave, sin registro. Agrega las tasas
 * de referencia de 98 bancos centrales, 205 monedas, con histórico desde 1948.
 *
 * Las tres decisiones que definen este cliente, y el porqué de cada una:
 *
 * · CACHÉ que obedece al `Cache-Control` del servidor en vez de un TTL
 *   inventado — ver `cache.ts`.
 * · REINTENTOS con espera exponencial, porque el uptime real ronda el 86% —
 *   ver `reintentos.ts`.
 * · ARITMÉTICA DECIMAL para convertir importes, porque `0.1 + 0.2` no da 0.3 —
 *   ver `dinero.ts`.
 */

import { Cache, leerCacheControl } from './cache.js';
import { conReintentos, type OpcionesReintento } from './reintentos.js';
import { Dinero, type ModoRedondeo } from './dinero.js';
import {
  MonedaNoSoportadaError,
  PeticionInvalidaError,
  RespuestaInesperadaError,
  ServicioNoDisponibleError,
  TiempoAgotadoError,
} from './errores.js';
import {
  aMoneda,
  aTasa,
  type ErrorCrudo,
  type Moneda,
  type OpcionesTasas,
  type Tasa,
} from './tipos.js';

export interface OpcionesCliente {
  /** Raíz de la API. Cambiable para apuntar a un espejo o a un doble de test. */
  urlBase?: string;
  /** Milisegundos antes de abandonar una petición. Por defecto 10 000. */
  tiempoMaximoMs?: number;
  /** Opciones de reintento. `intentos: 1` los desactiva. */
  reintentos?: OpcionesReintento;
  /** `false` desactiva la caché por completo. */
  cache?: boolean;
  /** Segundos de caché cuando el servidor no manda `max-age`. */
  cachePorDefecto?: number;
  /** Implementación de fetch. Inyectable para los tests. */
  fetch?: typeof globalThis.fetch;
}

interface RespuestaCruda {
  cuerpo: unknown;
  cacheControl: string | null;
}

export class ClienteFrankfurter {
  private readonly urlBase: string;
  private readonly tiempoMaximoMs: number;
  private readonly opcionesReintento: OpcionesReintento;
  private readonly cache: Cache<RespuestaCruda> | null;
  private readonly hacerFetch: typeof globalThis.fetch;

  constructor(opciones: OpcionesCliente = {}) {
    this.urlBase = (opciones.urlBase ?? 'https://api.frankfurter.dev/v2').replace(/\/$/, '');
    this.tiempoMaximoMs = opciones.tiempoMaximoMs ?? 10_000;
    this.opcionesReintento = opciones.reintentos ?? {};
    this.cache =
      opciones.cache === false
        ? null
        : new Cache<RespuestaCruda>({ porDefecto: opciones.cachePorDefecto });
    this.hacerFetch = opciones.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Tasas. El mismo método cubre cuatro casos porque la API devuelve la misma
   * forma plana en todos:
   *
   *   tasas()                                  → últimas, todas las monedas
   *   tasas({ base:'EUR', cotizadas:['COP'] }) → últimas, filtradas
   *   tasas({ fecha:'2020-03-15' })            → un día concreto
   *   tasas({ desde:'2026-01-01' })            → serie temporal
   */
  async tasas(opciones: OpcionesTasas = {}): Promise<Tasa[]> {
    if (opciones.fecha && (opciones.desde || opciones.hasta)) {
      throw new TypeError('Usa `fecha` para un día suelto o `desde`/`hasta` para una serie, no ambos.');
    }

    const params = new URLSearchParams();
    if (opciones.base) params.set('base', opciones.base.toUpperCase());
    if (opciones.cotizadas?.length) {
      params.set('quotes', opciones.cotizadas.map((m) => m.toUpperCase()).join(','));
    }
    if (opciones.fecha) params.set('date', opciones.fecha);
    if (opciones.desde) params.set('from', opciones.desde);
    if (opciones.hasta) params.set('to', opciones.hasta);
    if (opciones.agrupar) params.set('group', opciones.agrupar);

    const { cuerpo, caducada } = await this.pedir(`/rates${sufijo(params)}`);

    if (!Array.isArray(cuerpo)) {
      throw new RespuestaInesperadaError('Se esperaba un array de tasas');
    }
    const tasas = cuerpo.map(aTasa);
    return caducada ? tasas.map((t) => ({ ...t, caducada: true })) : tasas;
  }

  /** Un par concreto: `tasa('EUR', 'COP')`. */
  async tasa(base: string, cotizada: string): Promise<Tasa> {
    const ruta = `/rate/${encodeURIComponent(base.toLowerCase())}/${encodeURIComponent(cotizada.toLowerCase())}`;
    const { cuerpo, caducada } = await this.pedir(ruta);
    const t = aTasa(cuerpo);
    return caducada ? { ...t, caducada: true } : t;
  }

  /** Catálogo de monedas. */
  async monedas(): Promise<Moneda[]> {
    const { cuerpo } = await this.pedir('/currencies');
    if (!Array.isArray(cuerpo)) {
      throw new RespuestaInesperadaError('Se esperaba un array de monedas');
    }
    return cuerpo.map(aMoneda);
  }

  /**
   * Convierte un importe, con aritmética decimal.
   *
   * El importe entra como texto ("100.50") a propósito: si entrara como
   * `number`, la precisión ya se podría haber perdido antes de llegar aquí y
   * este módulo no tendría nada que salvar.
   */
  async convertir(
    cantidad: string | number,
    de: string,
    a: string,
    modo: ModoRedondeo = 'mitad-arriba',
  ): Promise<{ origen: Dinero; destino: Dinero; tasa: Tasa }> {
    const origen = Dinero.de(cantidad, de);
    if (de.toUpperCase() === a.toUpperCase()) {
      return {
        origen,
        destino: origen,
        tasa: { fecha: hoy(), base: de.toUpperCase(), cotizada: a.toUpperCase(), valor: 1 },
      };
    }
    const tasa = await this.tasa(de, a);
    return { origen, destino: origen.convertirA(a, String(tasa.valor), modo), tasa };
  }

  /* ------------------------------------------------------------- */

  private async pedir(ruta: string): Promise<{ cuerpo: unknown; caducada: boolean }> {
    const url = this.urlBase + ruta;

    const enCache = this.cache?.obtener(url);
    if (enCache?.estado === 'fresco') {
      return { cuerpo: enCache.valor!.cuerpo, caducada: false };
    }

    try {
      const respuesta = await conReintentos(() => this.pedirUnaVez(url), this.opcionesReintento);
      this.cache?.guardar(url, respuesta, leerCacheControl(respuesta.cacheControl));
      return { cuerpo: respuesta.cuerpo, caducada: false };
    } catch (e) {
      // Aquí se cobra `stale-if-error`: antes de propagar el fallo, se mira si
      // queda una copia caducada todavía utilizable. Una tasa de ayer es mucho
      // mejor respuesta que una excepción, siempre que se diga que es de ayer.
      if (enCache?.estado === 'caducado') {
        return { cuerpo: enCache.valor!.cuerpo, caducada: true };
      }
      throw e;
    }
  }

  private async pedirUnaVez(url: string): Promise<RespuestaCruda> {
    const corte = AbortSignal.timeout(this.tiempoMaximoMs);

    let respuesta: Response;
    try {
      respuesta = await this.hacerFetch(url, {
        signal: corte,
        headers: { accept: 'application/json' },
      });
    } catch (e) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new TiempoAgotadoError(`Tiempo agotado tras ${this.tiempoMaximoMs} ms`, undefined, e);
      }
      throw new ServicioNoDisponibleError('No se pudo contactar con la API', undefined, e);
    }

    if (!respuesta.ok) throw await this.aError(respuesta);

    let cuerpo: unknown;
    try {
      cuerpo = await respuesta.json();
    } catch (e) {
      throw new RespuestaInesperadaError('La respuesta no era JSON válido', e);
    }

    return { cuerpo, cacheControl: respuesta.headers.get('cache-control') };
  }

  /** Traduce una respuesta de error al tipo que le corresponde. */
  private async aError(respuesta: Response): Promise<Error> {
    let mensaje = `La API respondió ${respuesta.status}`;
    let crudo: Partial<ErrorCrudo> = {};

    try {
      crudo = (await respuesta.json()) as Partial<ErrorCrudo>;
      if (typeof crudo.message === 'string') mensaje = crudo.message;
    } catch {
      // Un error sin cuerpo JSON es perfectamente posible; nos quedamos con
      // el mensaje genérico.
    }

    // 5xx y 429 son del servidor o de ritmo: se reintentan.
    if (respuesta.status >= 500 || respuesta.status === 429) {
      return new ServicioNoDisponibleError(mensaje, respuesta.status);
    }

    // La API contesta 422 a las peticiones mal formadas —no 400, pese a lo que
    // dice su documentación. Comprobado contra el servicio real.
    const moneda = mensaje.match(/invalid currency:\s*([A-Za-z]{3})/i);
    if (moneda) {
      return new MonedaNoSoportadaError(moneda[1].toUpperCase(), mensaje, respuesta.status);
    }

    return new PeticionInvalidaError(mensaje, respuesta.status);
  }
}

function sufijo(params: URLSearchParams): string {
  const s = params.toString();
  return s ? `?${s}` : '';
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}
