/**
 * Caché que obedece al servidor.
 *
 * La primera versión de este módulo iba a tener un TTL fijo de una hora, con
 * el razonamiento de que las tasas se publican una vez al día. Al mirar las
 * respuestas reales apareció algo mejor:
 *
 *     cache-control: public, max-age=35504, stale-if-error=86400
 *
 * El servidor ya dice cuánto vale su respuesta. Y ese `max-age` no es un
 * número redondo por casualidad: son los segundos que faltan para la próxima
 * publicación. Si lo respetamos, la caché caduca justo cuando hay datos
 * nuevos — ni antes (peticiones de más) ni después (datos viejos).
 *
 * `stale-if-error=86400` es la otra mitad: "si al revalidar fallo, sirve lo
 * viejo hasta 24 h". Con un servicio cuyo uptime ronda el 86%, eso convierte
 * una caída en una respuesta buena marcada como `caducada` en vez de un error.
 *
 * Inventar un TTL propio habría sido ignorar información que la fuente ya nos
 * está dando.
 */

interface Entrada<T> {
  valor: T;
  /** Hasta cuándo se sirve sin preguntar. */
  frescoHasta: number;
  /** Hasta cuándo se puede servir caducado SI la red falla. */
  utilizableHasta: number;
}

export type EstadoCache = 'fresco' | 'caducado' | 'ausente';

export interface Resultado<T> {
  estado: EstadoCache;
  valor?: T;
}

export interface Directivas {
  maxAge: number | null;
  staleIfError: number;
  noStore: boolean;
}

/**
 * Lee las directivas relevantes de una cabecera `Cache-Control`.
 * Lo que no entiende, lo ignora: es una caché, no un proxy conforme al RFC.
 */
export function leerCacheControl(cabecera: string | null): Directivas {
  const d: Directivas = { maxAge: null, staleIfError: 0, noStore: false };
  if (!cabecera) return d;

  const texto = cabecera.toLowerCase();
  if (/\bno-store\b/.test(texto) || /\bno-cache\b/.test(texto)) d.noStore = true;

  const maxAge = texto.match(/\bmax-age\s*=\s*(\d+)/);
  if (maxAge) d.maxAge = Number(maxAge[1]);

  const stale = texto.match(/\bstale-if-error\s*=\s*(\d+)/);
  if (stale) d.staleIfError = Number(stale[1]);

  return d;
}

export interface OpcionesCache {
  /** Entradas máximas antes de desalojar la más antigua. */
  maximo?: number;
  /** Segundos a usar cuando el servidor no manda `max-age`. */
  porDefecto?: number;
  /** Reloj inyectable — los tests no deberían dormir de verdad. */
  ahora?: () => number;
}

export class Cache<T> {
  private entradas = new Map<string, Entrada<T>>();
  private readonly maximo: number;
  private readonly porDefecto: number;
  private readonly ahora: () => number;

  constructor(opciones: OpcionesCache = {}) {
    this.maximo = opciones.maximo ?? 500;
    // Una hora: suficiente si el servidor calla, y corto frente al ciclo
    // diario de publicación.
    this.porDefecto = opciones.porDefecto ?? 3600;
    this.ahora = opciones.ahora ?? (() => Date.now());
  }

  obtener(clave: string): Resultado<T> {
    const e = this.entradas.get(clave);
    if (!e) return { estado: 'ausente' };

    const t = this.ahora();
    if (t < e.frescoHasta) return { estado: 'fresco', valor: e.valor };
    if (t < e.utilizableHasta) return { estado: 'caducado', valor: e.valor };

    this.entradas.delete(clave);
    return { estado: 'ausente' };
  }

  guardar(clave: string, valor: T, directivas: Directivas): void {
    if (directivas.noStore) return;

    const t = this.ahora();
    const vida = (directivas.maxAge ?? this.porDefecto) * 1000;

    this.entradas.set(clave, {
      valor,
      frescoHasta: t + vida,
      utilizableHasta: t + vida + directivas.staleIfError * 1000,
    });

    // Desalojo simple: la entrada más antigua insertada. Map conserva el orden
    // de inserción, así que la primera clave es la más vieja.
    if (this.entradas.size > this.maximo) {
      const primera = this.entradas.keys().next().value;
      if (primera !== undefined) this.entradas.delete(primera);
    }
  }

  vaciar(): void {
    this.entradas.clear();
  }

  get tamano(): number {
    return this.entradas.size;
  }
}
