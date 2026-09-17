import { describe, it, expect } from 'vitest';
import { Dinero, decimalesDe } from '../src/dinero';

describe('el problema que este módulo existe para resolver', () => {
  it('con number, 0.1 + 0.2 no da 0.3', () => {
    // Esto no es un fallo del test: es JavaScript. Se deja escrito para que
    // quede claro de qué estamos huyendo.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('con Dinero, 0,10 + 0,20 da exactamente 0,30', () => {
    const a = Dinero.de('0.10', 'EUR');
    const b = Dinero.de('0.20', 'EUR');
    expect(a.sumar(b).aTexto()).toBe('0.30');
  });

  it('sumar 0,01 cien veces da exactamente 1,00', () => {
    let total = Dinero.de('0', 'EUR');
    for (let i = 0; i < 100; i++) total = total.sumar(Dinero.de('0.01', 'EUR'));
    expect(total.aTexto()).toBe('1.00');

    // La misma suma con number se desvía:
    let flotante = 0;
    for (let i = 0; i < 100; i++) flotante += 0.01;
    expect(flotante).not.toBe(1);
  });
});

describe('decimales por moneda', () => {
  it('el peso colombiano no tiene decimales', () => {
    expect(decimalesDe('COP')).toBe(0);
    expect(Dinero.de('89900', 'COP').aTexto()).toBe('89900');
  });

  it('el euro tiene dos', () => {
    expect(decimalesDe('EUR')).toBe(2);
    expect(Dinero.de('12.3', 'EUR').aTexto()).toBe('12.30');
  });

  it('el dinar kuwaití tiene tres', () => {
    expect(decimalesDe('KWD')).toBe(3);
    expect(Dinero.de('1.5', 'KWD').aTexto()).toBe('1.500');
  });

  it('una moneda desconocida asume dos', () => {
    expect(decimalesDe('XYZ')).toBe(2);
  });
});

describe('conversión con tasa', () => {
  it('100 EUR a 4312.85 COP/EUR da 431285 COP exactos', () => {
    const eur = Dinero.de('100', 'EUR');
    const cop = eur.convertirA('COP', '4312.85');
    expect(cop.aTexto()).toBe('431285');
    expect(cop.moneda).toBe('COP');
  });

  it('la tasa puede venir como number sin romper la precisión', () => {
    const eur = Dinero.de('100', 'EUR');
    expect(eur.convertirA('COP', 4312.85).aTexto()).toBe('431285');
  });

  it('convertir y volver no se aleja más de una unidad mínima', () => {
    const original = Dinero.de('250.00', 'EUR');
    const ida = original.convertirA('USD', '1.0865');
    const vuelta = ida.convertirA('EUR', String(1 / 1.0865));
    const diferencia = vuelta.restar(original).minimas;
    const abs = diferencia < 0n ? -diferencia : diferencia;
    expect(abs <= 1n).toBe(true);
  });

  it('importes grandes no pierden precisión', () => {
    // Nueve mil millones de céntimos: con number ya estaríamos en terreno
    // peligroso al multiplicar por una tasa.
    const grande = Dinero.de('90000000.00', 'EUR');
    expect(grande.convertirA('COP', '4312.85').aTexto()).toBe('388156500000');
  });
});

describe('redondeo', () => {
  it('mitad-arriba sube en el empate exacto', () => {
    // 1 EUR × 1.005 = 1.005 USD → 1,01
    expect(Dinero.de('1.00', 'EUR').convertirA('USD', '1.005', 'mitad-arriba').aTexto()).toBe('1.01');
  });

  it('mitad-par va al par en el empate exacto', () => {
    // 1.005 → 1.00 (el 0 es par); 1.015 → 1.02 (el 2 es par)
    expect(Dinero.de('1.00', 'EUR').convertirA('USD', '1.005', 'mitad-par').aTexto()).toBe('1.00');
    expect(Dinero.de('1.00', 'EUR').convertirA('USD', '1.015', 'mitad-par').aTexto()).toBe('1.02');
  });

  it('truncar nunca sube', () => {
    expect(Dinero.de('1.00', 'EUR').convertirA('USD', '1.009', 'truncar').aTexto()).toBe('1.00');
  });

  it('el redondeo respeta el signo', () => {
    expect(Dinero.de('-1.00', 'EUR').convertirA('USD', '1.005', 'mitad-arriba').aTexto()).toBe('-1.01');
  });
});

describe('operaciones', () => {
  it('multiplicar por unidades es exacto', () => {
    expect(Dinero.de('89.900', 'EUR').porUnidades(3).aTexto()).toBe('269.70');
  });

  it('rechaza multiplicar por un decimal', () => {
    expect(() => Dinero.de('10', 'EUR').porUnidades(1.5)).toThrow(TypeError);
  });

  it('rechaza sumar monedas distintas', () => {
    expect(() => Dinero.de('10', 'EUR').sumar(Dinero.de('10', 'USD'))).toThrow(/monedas distintas/);
  });

  it('resta con resultado negativo', () => {
    expect(Dinero.de('10', 'EUR').restar(Dinero.de('25.50', 'EUR')).aTexto()).toBe('-15.50');
  });
});

describe('entradas inválidas', () => {
  it('rechaza texto que no es un número', () => {
    expect(() => Dinero.de('doce euros', 'EUR')).toThrow(TypeError);
  });

  it('rechaza NaN e Infinity', () => {
    expect(() => Dinero.de(NaN, 'EUR')).toThrow(TypeError);
    expect(() => Dinero.de(Infinity, 'EUR')).toThrow(TypeError);
  });

  it('rechaza una tasa que no es un número', () => {
    expect(() => Dinero.de('10', 'EUR').convertirA('USD', 'gratis')).toThrow(TypeError);
  });
});

describe('detalles finos', () => {
  it('más decimales de los que admite la moneda se redondean al crear', () => {
    expect(Dinero.de('12.346', 'EUR').aTexto()).toBe('12.35');
    expect(Dinero.de('12.344', 'EUR').aTexto()).toBe('12.34');
  });

  it('desdeMinimas y de coinciden', () => {
    expect(Dinero.desdeMinimas(1234n, 'EUR').equivale(Dinero.de('12.34', 'EUR'))).toBe(true);
  });

  it('formatea según la configuración regional', () => {
    const texto = Dinero.de('89900', 'COP').formatear('es-CO');
    expect(texto).toMatch(/89\.900/);
  });

  it('el código de moneda no distingue mayúsculas', () => {
    expect(Dinero.de('10', 'eur').moneda).toBe('EUR');
  });
});
