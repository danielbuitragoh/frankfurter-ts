/**
 * Errores tipados.
 *
 * El objetivo es que quien use el paquete pueda distinguir "te equivocaste tú"
 * de "se cayó el servidor" con un `instanceof`, sin tener que leer mensajes de
 * texto. Un cliente que solo lanza `Error` con un string obliga a quien lo
 * consume a hacer `if (e.message.includes('...'))`, que se rompe en cuanto
 * alguien reescribe el mensaje.
 */

export class FrankfurterError extends Error {
  constructor(mensaje: string, readonly causa?: unknown) {
    super(mensaje);
    this.name = new.target.name;
    // Necesario al extender Error compilando a ES5/ES2015 en algunos objetivos.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * La petición era inválida: moneda inexistente, fecha mal formada, rango
 * imposible. Reintentar no arregla nada — hay que corregir la llamada.
 *
 * La API responde 422 a estos casos (no 400, como sugiere su documentación;
 * comprobado contra el servicio real).
 */
export class PeticionInvalidaError extends FrankfurterError {
  constructor(mensaje: string, readonly estado: number) {
    super(mensaje);
  }
}

/** Caso concreto y frecuente de petición inválida: la moneda no existe. */
export class MonedaNoSoportadaError extends PeticionInvalidaError {
  constructor(readonly moneda: string, mensaje: string, estado: number) {
    super(mensaje, estado);
  }
}

/**
 * El servicio no respondió, o respondió con un 5xx. Esto SÍ se reintenta:
 * el uptime medido de Frankfurter ronda el 86%, así que es un caso normal,
 * no excepcional.
 */
export class ServicioNoDisponibleError extends FrankfurterError {
  constructor(mensaje: string, readonly estado?: number, causa?: unknown) {
    super(mensaje, causa);
  }
}

/** La respuesta llegó, pero no tenía la forma esperada. */
export class RespuestaInesperadaError extends FrankfurterError {}

/** Se agotó el tiempo de espera. */
export class TiempoAgotadoError extends ServicioNoDisponibleError {}

/** ¿Merece la pena reintentar este error? */
export function esReintentable(e: unknown): boolean {
  return e instanceof ServicioNoDisponibleError;
}
