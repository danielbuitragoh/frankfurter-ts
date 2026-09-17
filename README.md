<div align="center">

# frankfurter-ts

**Cliente en TypeScript de la API de divisas Frankfurter, con caché que obedece al servidor, reintentos con espera exponencial y aritmética de dinero sin coma flotante.**

[![Verificar](https://github.com/danielbuitragoh/frankfurter-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/danielbuitragoh/frankfurter-ts/actions/workflows/ci.yml)

[npm](https://www.npmjs.com/package/frankfurter-ts) · [Código](https://github.com/danielbuitragoh/frankfurter-ts)

</div>

---

## Qué es

`frankfurter-ts` envuelve la API pública de [Frankfurter](https://frankfurter.dev), que agrega las tasas de referencia de 98 bancos centrales, cubre 205 monedas y tiene histórico desde 1948. No hace falta clave ni registro: instalas el paquete y ya consultas tasas. Lo que aporta el paquete no es el acceso —eso lo da un `fetch`—, sino todo lo que hay alrededor de ese `fetch` y que decide si un conversor de divisas es fiable o es un juguete.

Un cliente de divisas tiene tres problemas que no son evidentes hasta que te los encuentras en producción: los datos se publican una vez al día y no tiene sentido pedirlos cada minuto, el servicio se cae más de lo que uno espera, y el dinero no se puede sumar con `number` sin que tarde o temprano una factura salga descuadrada por un céntimo. Este paquete existe porque los tres tienen solución, y la solución correcta es bastante concreta en cada caso.

La librería está escrita en TypeScript con tipos derivados de las respuestas reales de la API, trae un ejecutable `fx` para usarla desde la terminal, y va acompañada de 59 pruebas en verde con Vitest que cubren desde la aritmética de importes hasta el comportamiento del cliente cuando el servidor deja de responder.

## Lo que más me interesa que se mire

**El dinero se guarda como entero de unidades mínimas con `bigint`, y el redondeo ocurre una sola vez, al final y de forma explícita.** El problema de fondo es que `0.1 + 0.2 === 0.30000000000000004`: los `number` de JavaScript son IEEE-754 binarios y hay decimales de base 10 que en base 2 no tienen representación exacta. La clase `Dinero` guarda 12,34 € como `1234n` y opera en enteros. Más importante todavía: cuando convierte, la tasa también se pasa a entero escalado antes de multiplicar, así que en ningún punto del cálculo hay un `number` en medio. La alternativa fácil —multiplicar por la tasa como `number` y hacer `.toFixed(2)`— redondea implícitamente y en varios sitios distintos, que es exactamente cómo se acumulan los descuadres. Aquí el modo de redondeo es un parámetro (`mitad-arriba`, `mitad-par`, `truncar`) porque comercio y contabilidad no redondean igual, y el paquete no debería decidirlo por ti.

**La caché respeta el `Cache-Control` del servidor en vez de inventarse un TTL.** La primera intención era un TTL fijo de una hora, razonando que las tasas se publican una vez al día. Al mirar las respuestas reales apareció algo mejor: el servidor manda `max-age=35504, stale-if-error=86400`, y ese `max-age` no es un número redondo por casualidad, son los segundos que faltan para la próxima publicación. Si lo respetas, la caché caduca justo cuando hay datos nuevos: ni antes, gastando peticiones de más, ni después, sirviendo datos viejos. Inventar un TTL propio habría sido tirar a la basura información que la fuente ya te está dando gratis.

**Cuando la API no responde se sirve la copia caducada marcada con `caducada: true`, en vez de propagar el error.** Esta es la otra mitad del `Cache-Control`: `stale-if-error=86400` significa "si al revalidar fallo, sirve lo viejo hasta 24 horas". Con un servicio cuyo uptime medido ronda el 86%, eso convierte una caída en una respuesta buena en lugar de una excepción. La decisión clave no es servir el dato viejo, es marcarlo: una tasa de ayer sigue siendo una tasa perfectamente válida —cambian una vez al día—, pero quien la consume tiene derecho a saber que no acaba de llegar de la fuente y a decidir qué hace con esa información. Devolverlo en silencio habría sido mentir; devolver un error habría sido romper la aplicación de quien llama por nada.

**Los reintentos usan espera exponencial con ruido aleatorio completo, y solo para errores que tiene sentido reintentar.** Con un 86% de disponibilidad, una de cada siete peticiones puede fallar: rendirse al primer intento es entregar un cliente que no funciona un día de cada siete. Dos detalles suelen faltar en las implementaciones caseras. El primero es el ruido: sin él, todos los clientes que fallaron a la vez reintentan a la vez y la segunda oleada vuelve a tumbar al servidor que justo se estaba levantando —el efecto manada atronadora—. Aquí se usa ruido completo, una espera al azar entre cero y el exponencial, que dispersa mucho mejor que sumar un porcentaje pequeño, porque ese porcentaje deja a todo el mundo prácticamente junto. El segundo es la selectividad: una moneda que no existe va a seguir sin existir dentro de dos segundos, así que reintentarla es castigar al servidor por un error nuestro. Solo se reintenta `ServicioNoDisponibleError`.

**Los errores son tipos, no cadenas de texto.** `MonedaNoSoportadaError`, `PeticionInvalidaError`, `ServicioNoDisponibleError`, `TiempoAgotadoError` y `RespuestaInesperadaError` forman una jerarquía con la que quien consume el paquete distingue "te has equivocado tú" de "se ha caído el servidor" con un `instanceof`. Un cliente que solo lanza `Error` con un mensaje obliga a escribir `if (e.message.includes('...'))`, que se rompe el día que alguien reescribe el mensaje. Esa jerarquía es además lo que hace posible la regla de reintentos del punto anterior: la decisión de reintentar se lee del tipo, no de una heurística sobre texto.

**Las respuestas de la API se validan, no se asertan.** La API v2 devuelve arrays planos con una fila por tasa, forma que no salió de la documentación sino de llamarla de verdad y volcar las respuestas. Al traducir, `aTasa` y `aMoneda` comprueban los campos y lanzan si no cuadran, en lugar de hacer `as Tasa`. Un aserto de tipo es una promesa al compilador, no una comprobación: si la fuente cambia de forma, sin validación el fallo aparece mucho más tarde y en otro sitio, con un `undefined` propagándose por media aplicación. También hay cosas que solo se descubren contra el servicio real, como que responde 422 a las peticiones mal formadas y no 400, pese a lo que dice su propia documentación.

**Todo lo que toca el mundo exterior es inyectable, y por eso las 59 pruebas no llaman a la red.** El cliente acepta `fetch`, la caché acepta su reloj, los reintentos aceptan su función de dormir y su generador aleatorio, y el CLI acepta un cliente ya construido. Eso permite probar de verdad los casos que importan —que un 500 se reintenta y un 422 no, que la copia caducada se sirve cuando la API se cae, que el reintento espera lo que debe— de forma determinista y en milisegundos. Una suite que depende de la red no prueba tu código, prueba tu conexión, y falla en CI por motivos que no son tuyos.

**El CLI existe para que la API pública tenga que ser cómoda de verdad.** `fx` convierte el paquete en algo que se usa, no solo en algo que se importa, y de paso funciona como prueba de diseño: si montar una interfaz de línea de comandos encima de la librería resulta incómodo, la librería está mal diseñada. Se parsean los argumentos a mano —son cuatro casos y una dependencia de terceros para esto pesaría más que el trabajo que hace—, se colorea la salida solo si va a una terminal, porque al redirigir a un archivo los códigos de escape estorban, y cada tipo de error tiene su mensaje: decirle "error" a quien ha escrito mal una moneda no le ayuda a arreglarlo.

## Instalación

```bash
npm install frankfurter-ts
```

Requiere Node 18 o superior, porque usa `fetch` nativo. No tiene dependencias en tiempo de ejecución.

## Uso

Convertir un importe:

```ts
import { ClienteFrankfurter } from 'frankfurter-ts';

const api = new ClienteFrankfurter();

const { origen, destino, tasa } = await api.convertir('100', 'EUR', 'COP');

console.log(destino.aTexto());                  // "431285"
console.log(destino.formatear('es-CO'));        // $ 431.285
console.log(`1 ${tasa.base} = ${tasa.valor} ${tasa.cotizada} · ${tasa.fecha}`);
```

El importe entra como texto a propósito: si entrara como `number`, la precisión ya se podría haber perdido antes de llegar al paquete.

Consultar tasas. El mismo método cubre cuatro casos, porque la API devuelve la misma forma plana en todos:

```ts
await api.tasas();                                   // últimas, todas las monedas
await api.tasas({ base: 'EUR', cotizadas: ['COP'] }); // últimas, filtradas
await api.tasas({ fecha: '2020-03-15' });             // un día concreto
await api.tasas({ desde: '2026-01-01' });             // serie temporal
await api.tasas({ desde: '2020-01-01', agrupar: 'month' });

const par = await api.tasa('EUR', 'COP');             // un par suelto
const catalogo = await api.monedas();                 // catálogo completo
```

Aritmética de dinero, sin pasar por la API:

```ts
import { Dinero } from 'frankfurter-ts';

const a = Dinero.de('0.10', 'EUR');
const b = Dinero.de('0.20', 'EUR');

a.sumar(b).aTexto();                  // "0.30" exacto
Dinero.de('19.99', 'EUR').porUnidades(3).aTexto();   // "59.97"

// La tasa se pasa a entero escalado antes de multiplicar.
Dinero.de('100', 'EUR').convertirA('COP', '4312.85').aTexto();   // "431285"

// El redondeo es explícito y elegible: en el empate exacto, mitad-par
// baja al par y mitad-arriba sube.
Dinero.de('1', 'EUR').convertirA('USD', '1.005', 'mitad-par').aTexto();     // "1.00"
Dinero.de('1', 'EUR').convertirA('USD', '1.005', 'mitad-arriba').aTexto();  // "1.01"
```

Saber si un dato viene de caché caducada porque la API no respondía:

```ts
const tasa = await api.tasa('EUR', 'USD');
if (tasa.caducada) {
  console.warn(`Dato de ${tasa.fecha}: la API no respondía.`);
}
```

Distinguir errores por tipo:

```ts
import { MonedaNoSoportadaError, ServicioNoDisponibleError } from 'frankfurter-ts';

try {
  await api.tasa('EUR', 'XYZ');
} catch (e) {
  if (e instanceof MonedaNoSoportadaError) {
    console.error(`"${e.moneda}" no existe.`);       // no se reintenta
  } else if (e instanceof ServicioNoDisponibleError) {
    console.error('La API no responde.');            // sí se reintentó
  }
}
```

Ajustar el comportamiento del cliente:

```ts
const api = new ClienteFrankfurter({
  tiempoMaximoMs: 5_000,
  reintentos: { intentos: 5, esperaBase: 200, esperaMaxima: 4_000 },
  cache: true,
});
```

Desde la terminal, con el ejecutable `fx`:

```bash
fx 100 EUR COP
# 100,00 €  →  431.285 COP
# 1 EUR = 4312.85 COP · 2026-09-16

fx 49.99 eur usd
fx 1000 USD EUR --fecha 2020-03-15
fx --monedas peso
fx 100 EUR COP --json
fx --help
```

`--json` da salida encadenable con otros comandos, `--fecha` consulta un día concreto —hay datos desde 1948— y `--sin-cache` fuerza la consulta ignorando la caché.

## Cómo correrlo

```bash
npm install
npm test        # 59 pruebas con Vitest
npm run build   # compila a dist/ con tsc
```

También hay `npm run verificar`, que comprueba tipos con `tsc --noEmit` y pasa la suite; es lo que corre CI sobre Node 18 y Node 22, y lo que se exige antes de publicar.

## Licencia

MIT · [Daniel Buitrago](https://github.com/danielbuitragoh)
