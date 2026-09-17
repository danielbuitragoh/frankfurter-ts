# Cómo subirlo a GitHub

Cliente TypeScript de tipos de cambio: caché que respeta el servidor, reintentos y aritmética exacta con BigInt.

## 1 · Crear el repositorio y subirlo

En GitHub, crea un repositorio nuevo llamado `frankfurter-ts`, **público** y **vacío**
(sin README, sin licencia, sin .gitignore — ya están aquí). Después, desde esta
carpeta:

```bash
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/danielbuitragoh/frankfurter-ts.git
git push -u origin main
```

Si la carpeta ya tenía git, sáltate `git init` y `git branch -M main`.

## 2 · Antes de publicar, comprueba

Que no sube ningún secreto:

```bash
git ls-files | grep -iE "\.env$|secret|credential"
```

Debe devolver vacío (o solo archivos `.ejemplo`).

## 3 · Publicar en npm

Esto solo lo puedes hacer tú: hace falta tu cuenta.

```bash
npm adduser          # abre el navegador y te identifica
npm publish --access public
```

Después, en `panel-divisas/package.json` y en cualquier otro proyecto que
lo use, cambia `"frankfurter-ts": "file:../frankfurter-ts"` por
`"frankfurter-ts": "^0.1.0"` y vuelve a instalar. Mientras sea `file:`,
quien clone esos repos no puede instalarlos.



## 4 · Los dos minutos que más rinden

En la portada del repositorio, junto a **About** (arriba a la derecha, el
engranaje):

- **Descripción:** Cliente TypeScript de tipos de cambio: caché que respeta el servidor, reintentos y aritmética exacta con BigInt.
- **Website:** el enlace de la demo si la hay, y si no, tu portafolio.
- **Topics:** `typescript, npm-package, exchange-rates, bigint, caching, vitest, cli, api-client`

Los topics son lo que hace que el repositorio aparezca en búsquedas de GitHub.

Y fíjalo en tu perfil: **tu perfil → Customize your pins**.
