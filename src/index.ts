/**
 * frankfurter-ts — cliente de la API de divisas Frankfurter.
 *
 * Caché que obedece al `Cache-Control` del servidor, reintentos con espera
 * exponencial, y aritmética de dinero sin coma flotante.
 *
 *   import { ClienteFrankfurter, Dinero } from 'frankfurter-ts';
 *
 *   const api = new ClienteFrankfurter();
 *   const { destino } = await api.convertir('100', 'EUR', 'COP');
 *   console.log(destino.formatear('es-CO'));   // $ 358.893
 */

export { ClienteFrankfurter, type OpcionesCliente } from './cliente.js';
export { Dinero, decimalesDe, type ModoRedondeo } from './dinero.js';
export { Cache, leerCacheControl, type Directivas } from './cache.js';
export { conReintentos, type OpcionesReintento } from './reintentos.js';
export {
  FrankfurterError,
  PeticionInvalidaError,
  MonedaNoSoportadaError,
  ServicioNoDisponibleError,
  RespuestaInesperadaError,
  TiempoAgotadoError,
  esReintentable,
} from './errores.js';
export type { Tasa, Moneda, OpcionesTasas, Agrupacion } from './tipos.js';
