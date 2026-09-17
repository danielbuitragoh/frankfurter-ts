/**
 * Aritmética de dinero sin coma flotante.
 *
 * El problema, en una línea: `0.1 + 0.2 === 0.30000000000000004`.
 * Los `number` de JavaScript son IEEE-754 binarios, y hay decimales de base 10
 * —como 0,1— que en base 2 no tienen representación exacta. Sumar precios con
 * `number` funciona hasta que un día una factura sale un céntimo descuadrada y
 * nadie sabe por qué.
 *
 * Aquí el dinero se guarda como un ENTERO de unidades mínimas (céntimos, o la
 * unidad que corresponda a la moneda) usando `bigint`, que no tiene límite de
 * precisión. 12,34 € se guarda como 1234n. Las operaciones son enteras, y el
 * redondeo ocurre UNA sola vez, al final, de forma explícita.
 *
 * Las tasas de cambio se tratan igual: en vez de multiplicar por un `number`
 * como 4312.85, se parsea a un entero escalado (43128500000n con escala 10) y
 * se multiplica entero contra entero.
 */

/** Modo de redondeo al convertir a la unidad mínima de destino. */
export type ModoRedondeo =
  /** 0,5 se aleja del cero: 2,5 → 3 · −2,5 → −3. El habitual en comercio. */
  | 'mitad-arriba'
  /** 0,5 va al par más cercano: 2,5 → 2 · 3,5 → 4. Reduce el sesgo acumulado. */
  | 'mitad-par'
  /** Trunca hacia cero: 2,9 → 2. */
  | 'truncar';

/**
 * Decimales de las monedas cuya unidad mínima NO son dos decimales.
 * El resto (EUR, USD, GBP…) usa 2, que es el valor por defecto.
 */
const DECIMALES_POR_MONEDA: Record<string, number> = {
  // Sin decimales en la práctica: nadie cotiza céntimos de peso ni de yen.
  COP: 0, JPY: 0, KRW: 0, CLP: 0, ISK: 0, HUF: 0, VND: 0, IDR: 0,
  // Tres decimales.
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};

/** Decimales de la unidad mínima de una moneda. Por defecto, 2. */
export function decimalesDe(moneda: string): number {
  return DECIMALES_POR_MONEDA[moneda.toUpperCase()] ?? 2;
}

export class Dinero {
  /** Importe en unidades mínimas. 12,34 € → 1234n */
  readonly minimas: bigint;
  readonly moneda: string;
  readonly decimales: number;

  private constructor(minimas: bigint, moneda: string, decimales: number) {
    this.minimas = minimas;
    this.moneda = moneda;
    this.decimales = decimales;
  }

  /**
   * Crea un importe a partir de una cantidad legible.
   *
   * Acepta `string` (recomendado: "12.34") o `number`. Con `number` se avisa
   * del riesgo: si el valor viene ya contaminado por coma flotante, aquí no
   * hay nada que recuperar — la precisión se perdió antes de llegar.
   */
  static de(cantidad: string | number, moneda: string): Dinero {
    const cod = moneda.toUpperCase();
    const dec = decimalesDe(cod);
    const texto = typeof cantidad === 'number' ? numeroATexto(cantidad, dec) : cantidad.trim();

    if (!/^-?\d+(\.\d+)?$/.test(texto)) {
      throw new TypeError(`Importe no válido: ${JSON.stringify(cantidad)}`);
    }

    const negativo = texto.startsWith('-');
    const [entera, fraccion = ''] = (negativo ? texto.slice(1) : texto).split('.');

    // Se rellena o se recorta la parte decimal hasta los decimales de la moneda.
    // Recortar es redondear, así que se hace con el modo explícito, no truncando.
    let minimas: bigint;
    if (fraccion.length <= dec) {
      minimas = BigInt(entera + fraccion.padEnd(dec, '0'));
    } else {
      const conservados = BigInt(entera + fraccion.slice(0, dec));
      const resto = fraccion.slice(dec);
      minimas = conservados + BigInt(redondeoDeResto(resto, 'mitad-arriba'));
    }

    return new Dinero(negativo ? -minimas : minimas, cod, dec);
  }

  /** Crea un importe directamente desde unidades mínimas. 1234n → 12,34 € */
  static desdeMinimas(minimas: bigint, moneda: string): Dinero {
    const cod = moneda.toUpperCase();
    return new Dinero(minimas, cod, decimalesDe(cod));
  }

  sumar(otro: Dinero): Dinero {
    this.exigirMismaMoneda(otro);
    return new Dinero(this.minimas + otro.minimas, this.moneda, this.decimales);
  }

  restar(otro: Dinero): Dinero {
    this.exigirMismaMoneda(otro);
    return new Dinero(this.minimas - otro.minimas, this.moneda, this.decimales);
  }

  /** Multiplica por un entero (p. ej. unidades de un carrito). */
  porUnidades(n: number): Dinero {
    if (!Number.isInteger(n)) {
      throw new TypeError('porUnidades espera un entero; para tasas usa convertirA');
    }
    return new Dinero(this.minimas * BigInt(n), this.moneda, this.decimales);
  }

  /**
   * Convierte a otra moneda aplicando una tasa.
   *
   * La tasa se parsea a entero escalado antes de multiplicar, así que en
   * ningún momento hay un `number` en medio del cálculo. El redondeo sucede
   * una única vez, aquí, y de forma explícita.
   */
  convertirA(moneda: string, tasa: string | number, modo: ModoRedondeo = 'mitad-arriba'): Dinero {
    const destino = moneda.toUpperCase();
    const decDestino = decimalesDe(destino);
    const { escalada, escala } = tasaAEntero(tasa);

    // minimasDestino = minimasOrigen · tasa · 10^decDestino / (10^decOrigen · 10^escala)
    const numerador = this.minimas * escalada * 10n ** BigInt(decDestino);
    const denominador = 10n ** BigInt(this.decimales) * 10n ** BigInt(escala);

    return new Dinero(dividirRedondeando(numerador, denominador, modo), destino, decDestino);
  }

  /** Representación legible: "12.34" */
  aTexto(): string {
    const negativo = this.minimas < 0n;
    const abs = (negativo ? -this.minimas : this.minimas).toString().padStart(this.decimales + 1, '0');
    const corte = abs.length - this.decimales;
    const entera = abs.slice(0, corte);
    const fraccion = abs.slice(corte);
    const cuerpo = this.decimales === 0 ? entera : `${entera}.${fraccion}`;
    return negativo ? `-${cuerpo}` : cuerpo;
  }

  /**
   * Convierte a `number`. Úsalo solo para mostrar o graficar, nunca para
   * seguir calculando: en cuanto el valor pasa por aquí, vuelve a ser
   * vulnerable a los errores de coma flotante que este módulo evita.
   */
  aNumero(): number {
    return Number(this.aTexto());
  }

  /** Formatea con separadores según la configuración regional. */
  formatear(locale = 'es-CO'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.moneda,
      minimumFractionDigits: this.decimales,
      maximumFractionDigits: this.decimales,
    }).format(this.aNumero());
  }

  equivale(otro: Dinero): boolean {
    return this.moneda === otro.moneda && this.minimas === otro.minimas;
  }

  private exigirMismaMoneda(otro: Dinero): void {
    if (this.moneda !== otro.moneda) {
      throw new TypeError(
        `No se pueden operar monedas distintas: ${this.moneda} y ${otro.moneda}. Convierte una primero.`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ayudas internas                                                      */
/* ------------------------------------------------------------------ */

/** Pasa una tasa a entero escalado: 4312.85 → { escalada: 431285n, escala: 2 } */
function tasaAEntero(tasa: string | number): { escalada: bigint; escala: number } {
  // Con `number` se usa notación no exponencial y suficientes dígitos para no
  // perder nada de lo que el double realmente contiene.
  const texto = typeof tasa === 'number' ? numeroATextoCompleto(tasa) : tasa.trim();

  if (!/^-?\d+(\.\d+)?$/.test(texto)) {
    throw new TypeError(`Tasa no válida: ${JSON.stringify(tasa)}`);
  }

  const negativa = texto.startsWith('-');
  const [entera, fraccion = ''] = (negativa ? texto.slice(1) : texto).split('.');
  const escalada = BigInt(entera + fraccion);

  return { escalada: negativa ? -escalada : escalada, escala: fraccion.length };
}

/** División entera con el redondeo pedido. Trabaja con signo. */
function dividirRedondeando(numerador: bigint, denominador: bigint, modo: ModoRedondeo): bigint {
  if (denominador === 0n) throw new RangeError('División por cero');

  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;

  const cociente = n / d;
  const resto = n % d;
  if (resto === 0n) return negativo ? -cociente : cociente;

  let ajuste = 0n;
  const doble = resto * 2n;

  switch (modo) {
    case 'truncar':
      ajuste = 0n;
      break;
    case 'mitad-arriba':
      ajuste = doble >= d ? 1n : 0n;
      break;
    case 'mitad-par':
      if (doble > d) ajuste = 1n;
      else if (doble < d) ajuste = 0n;
      else ajuste = cociente % 2n === 0n ? 0n : 1n; // empate: al par
      break;
  }

  const resultado = cociente + ajuste;
  return negativo ? -resultado : resultado;
}

/** Decide si un resto decimal ("567") suma 1 al último dígito conservado. */
function redondeoDeResto(resto: string, modo: ModoRedondeo): 0 | 1 {
  if (modo === 'truncar') return 0;
  const primero = resto.charCodeAt(0) - 48;
  if (primero > 5) return 1;
  if (primero < 5) return 0;
  // Exactamente 5: solo redondea arriba si hay algo más detrás, o si el modo
  // es mitad-arriba (que sí sube en el empate exacto).
  if (/[1-9]/.test(resto.slice(1))) return 1;
  return modo === 'mitad-arriba' ? 1 : 0;
}

/** Texto decimal de un number, sin notación exponencial, con N decimales. */
function numeroATexto(n: number, decimales: number): string {
  if (!Number.isFinite(n)) throw new TypeError(`Importe no finito: ${n}`);
  return n.toFixed(decimales);
}

/** Texto decimal de un number conservando todo lo que el double contiene. */
function numeroATextoCompleto(n: number): string {
  if (!Number.isFinite(n)) throw new TypeError(`Tasa no finita: ${n}`);
  // toFixed(20) es el máximo que admite la especificación y basta para
  // cualquier tasa real; se recortan los ceros sobrantes de la derecha.
  const texto = Math.abs(n) < 1e21 ? n.toFixed(20) : n.toString();
  return texto.includes('.') ? texto.replace(/0+$/, '').replace(/\.$/, '') : texto;
}
