/**
 * Tipos de la API de Frankfurter v2.
 *
 * Estas formas NO están adivinadas: salen de llamar a la API real y volcar las
 * respuestas (`reconocer-api.mjs` → `reconocimiento.json`). Importa decirlo
 * porque v2 no se parece a v1: la versión antigua devolvía un objeto con un
 * mapa `rates` anidado, y v2 devuelve arrays planos con una fila por tasa.
 *
 * Esa forma plana es una suerte: el mismo tipo `Tasa` sirve para las últimas
 * tasas, para una fecha histórica, para una serie temporal y para un par
 * suelto. Cuatro endpoints, un tipo.
 */

/* --------------------------------------------------------------- */
/* Lo que devuelve la API, tal cual (en inglés, sin tocar)           */
/* --------------------------------------------------------------- */

/** @internal */
export interface TasaCruda {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

/** @internal */
export interface MonedaCruda {
  iso_code: string;
  iso_numeric: string;
  name: string;
  symbol: string;
  start_date: string;
  end_date: string;
}

/** @internal */
export interface ErrorCrudo {
  status: number;
  message: string;
}

/* --------------------------------------------------------------- */
/* Lo que expone este paquete                                        */
/* --------------------------------------------------------------- */

/** Una tasa de cambio en una fecha concreta. */
export interface Tasa {
  /** Fecha de publicación, ISO corta: "2026-09-16". */
  fecha: string;
  /** Moneda de partida: "EUR". */
  base: string;
  /** Moneda de destino: "COP". */
  cotizada: string;
  /** Cuántas unidades de `cotizada` vale una de `base`. */
  valor: number;
  /**
   * True si esta tasa viene de caché caducada porque la API no respondía.
   * El dato sigue siendo bueno —las tasas cambian una vez al día— pero quien
   * lo consume tiene derecho a saber que no acaba de llegar de la fuente.
   */
  caducada?: boolean;
}

/** Una moneda del catálogo. */
export interface Moneda {
  /** Código ISO 4217: "COP". */
  codigo: string;
  /** Código numérico ISO: "170". */
  numerico: string;
  /** Nombre en inglés, tal como lo publica la fuente. */
  nombre: string;
  /** Símbolo: "$", "€", "د.إ". */
  simbolo: string;
  /** Primera fecha con datos. */
  desde: string;
  /** Última fecha con datos. */
  hasta: string;
}

/** Agrupación temporal admitida por la API en las series. */
export type Agrupacion = 'week' | 'month';

export interface OpcionesTasas {
  /** Moneda de partida. Por defecto la que use la API (EUR). */
  base?: string;
  /** Monedas de destino. Sin esto, devuelve todas. */
  cotizadas?: string[];
  /** Fecha concreta, ISO corta. Excluyente con `desde`/`hasta`. */
  fecha?: string;
  /** Inicio de la serie temporal. */
  desde?: string;
  /** Fin de la serie temporal. Sin esto, hasta hoy. */
  hasta?: string;
  /** Submuestrea la serie por semana o mes. */
  agrupar?: Agrupacion;
}

/* --------------------------------------------------------------- */
/* Traducción cruda → pública, con validación                        */
/* --------------------------------------------------------------- */

/**
 * Valida y traduce una fila de tasa.
 *
 * Se valida de verdad en vez de hacer `as Tasa`: un aserto de tipo es una
 * promesa al compilador, no una comprobación. Si la API cambia de forma, sin
 * esto el fallo aparecería mucho más tarde y en otro sitio.
 */
export function aTasa(crudo: unknown): Tasa {
  const c = crudo as Partial<TasaCruda>;
  if (
    typeof c?.date !== 'string' ||
    typeof c?.base !== 'string' ||
    typeof c?.quote !== 'string' ||
    typeof c?.rate !== 'number'
  ) {
    throw new TypeError(`Fila de tasa inesperada: ${JSON.stringify(crudo)?.slice(0, 200)}`);
  }
  return { fecha: c.date, base: c.base, cotizada: c.quote, valor: c.rate };
}

export function aMoneda(crudo: unknown): Moneda {
  const c = crudo as Partial<MonedaCruda>;
  if (typeof c?.iso_code !== 'string' || typeof c?.name !== 'string') {
    throw new TypeError(`Moneda inesperada: ${JSON.stringify(crudo)?.slice(0, 200)}`);
  }
  return {
    codigo: c.iso_code,
    numerico: c.iso_numeric ?? '',
    nombre: c.name,
    simbolo: c.symbol ?? '',
    desde: c.start_date ?? '',
    hasta: c.end_date ?? '',
  };
}
