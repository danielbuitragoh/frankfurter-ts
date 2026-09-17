/**
 * Reintentos con espera exponencial y ruido aleatorio.
 *
 * Esto no es adorno: el uptime de Frankfurter medido por terceros ronda el
 * 86%. Una de cada siete peticiones puede fallar, así que fallar a la primera
 * y rendirse sería entregar un cliente que no funciona un día de cada siete.
 *
 * Dos detalles que suelen faltar en las implementaciones caseras:
 *
 * 1. El RUIDO (jitter). Sin él, todos los clientes que fallaron a la vez
 *    reintentan a la vez, y la segunda oleada tumba otra vez al servidor que
 *    justo se estaba levantando. Es el efecto "manada atronadora".
 * 2. Solo se reintenta lo que tiene sentido reintentar. Una moneda que no
 *    existe va a seguir sin existir dentro de dos segundos: reintentarla es
 *    castigar al servidor por un error nuestro.
 */

import { esReintentable } from './errores.js';

export interface OpcionesReintento {
  /** Número de intentos en total, incluido el primero. */
  intentos?: number;
  /** Espera del primer reintento, en ms. Se duplica en cada vuelta. */
  esperaBase?: number;
  /** Techo de la espera, en ms. */
  esperaMaxima?: number;
  /** Decide si un error se reintenta. Por defecto, los de servicio. */
  reintentable?: (e: unknown) => boolean;
  /** Inyectable para no dormir de verdad en los tests. */
  dormir?: (ms: number) => Promise<void>;
  /** Inyectable para tests deterministas. */
  aleatorio?: () => number;
  /** Se llama antes de cada espera. Útil para registrar o depurar. */
  alReintentar?: (info: { intento: number; esperaMs: number; error: unknown }) => void;
}

const dormirDeVerdad = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ejecuta `tarea`, reintentando los fallos que merezca la pena reintentar.
 * Si se agotan los intentos, relanza el último error tal cual — envolverlo
 * escondería el tipo y quien llama perdería el `instanceof`.
 */
export async function conReintentos<T>(
  tarea: () => Promise<T>,
  opciones: OpcionesReintento = {},
): Promise<T> {
  const intentos = opciones.intentos ?? 3;
  const base = opciones.esperaBase ?? 300;
  const techo = opciones.esperaMaxima ?? 5000;
  const reintentable = opciones.reintentable ?? esReintentable;
  const dormir = opciones.dormir ?? dormirDeVerdad;
  const aleatorio = opciones.aleatorio ?? Math.random;

  let ultimo: unknown;

  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await tarea();
    } catch (e) {
      ultimo = e;

      const quedanIntentos = intento < intentos;
      if (!quedanIntentos || !reintentable(e)) throw e;

      // Exponencial: 300, 600, 1200… con techo.
      const exponencial = Math.min(base * 2 ** (intento - 1), techo);
      // Ruido completo: una espera al azar entre 0 y el exponencial. Dispersa
      // mejor que sumar un porcentaje pequeño, que deja a todos casi juntos.
      const esperaMs = Math.round(exponencial * aleatorio());

      opciones.alReintentar?.({ intento, esperaMs, error: e });
      await dormir(esperaMs);
    }
  }

  throw ultimo;
}
