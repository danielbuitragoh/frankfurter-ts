/**
 * Comprobación de CORS — bien hecha esta vez.
 *
 * El script anterior concluía "CORS ausente" y estaba mal: `fetch` desde Node
 * no manda cabecera `Origin`, y sin `Origin` el servidor no tiene ninguna
 * razón para responder `access-control-allow-origin`. Medía otra cosa.
 *
 * Lo correcto es simular lo que hace un navegador: mandar `Origin`, y además
 * probar la petición de sondeo (`OPTIONS`) que el navegador envía antes de
 * ciertas peticiones.
 *
 * Esto decide la arquitectura del proyecto 2: si CORS está abierto, el panel
 * de divisas es un sitio estático (gratis, sin servidor, sin arranques en
 * frío). Si no, necesita un backend que haga de intermediario.
 *
 * Uso: node comprobar-cors.mjs
 */

const URL_PRUEBA = 'https://api.frankfurter.dev/v2/rates?base=EUR&quotes=COP';
const ORIGEN = 'https://danielbuitragoh.github.io';

function mostrar(titulo, r) {
  console.log(`\n── ${titulo}`);
  console.log(`   estado: ${r.status}`);
  for (const clave of [
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-max-age',
    'vary',
  ]) {
    const v = r.headers.get(clave);
    if (v !== null) console.log(`   ${clave}: ${v}`);
  }
}

// 1 · GET con Origin, como una petición simple de navegador.
const get = await fetch(URL_PRUEBA, {
  headers: { origin: ORIGEN, accept: 'application/json' },
});
mostrar(`GET con Origin: ${ORIGEN}`, get);

// 2 · OPTIONS de sondeo, como el preflight del navegador.
const options = await fetch(URL_PRUEBA, {
  method: 'OPTIONS',
  headers: {
    origin: ORIGEN,
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'accept',
  },
});
mostrar('OPTIONS (preflight)', options);

// Veredicto
const permitido = get.headers.get('access-control-allow-origin');
console.log('\n' + '─'.repeat(60));
if (permitido === '*' || permitido === ORIGEN) {
  console.log('✓ CORS ABIERTO.');
  console.log('  El panel de divisas puede llamar la API desde el navegador.');
  console.log('  Proyecto 2 = sitio estático. Gratis y sin arranques en frío.');
} else if (permitido) {
  console.log(`⚠ CORS restringido a: ${permitido}`);
  console.log('  Hay que comprobar si tu dominio entra.');
} else {
  console.log('✗ Sin cabecera CORS ni con Origin presente.');
  console.log('  El navegador bloqueará la llamada: el proyecto 2 necesitaría');
  console.log('  un intermediario. Antes de replantear nada, confírmalo en el');
  console.log('  navegador (es la prueba definitiva): abre cualquier web, F12,');
  console.log('  pestaña Consola, y pega:');
  console.log(`\n    fetch('${URL_PRUEBA}').then(r => r.json()).then(console.log)\n`);
  console.log('  Si imprime las tasas, CORS funciona y este script se equivoca.');
}
