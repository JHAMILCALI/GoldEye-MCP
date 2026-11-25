# GoldEye Trace MCP

Servidor MCP remoto para consultar fichas publicadas sobre mercurio en Bolivia y enviar propuestas a una cola privada. Acepta MCP `2026-07-28` y `2025-11-25` por Streamable HTTP. URL pública: **https://goldeye-trace-mcp.pinata-server.workers.dev/mcp**.

## Repositorio y verificación

Este repositorio contiene el Worker, el catálogo canónico, la migración D1, pruebas, cliente de ejemplo y recursos de marca. La acción de GitHub en `.github/workflows/ci.yml` ejecuta `npm ci`, `npm test` y un empaquetado de prueba con Wrangler usando Node.js 24. También comprueba que el PNG y el módulo del icono coincidan con el SVG fuente.

Antes de publicar en un repositorio de GitHub, configura el remoto del repositorio elegido y sube la rama `main`:

```powershell
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

`.dev.vars`, `.env*`, `node_modules` y los artefactos locales de Wrangler quedan fuera de Git. `wrangler.toml` contiene el ID de la base D1, que identifica un recurso pero no concede acceso a él. No subas el valor de `ADMIN_TOKEN`.

## Estado actual

- El transporte MCP y las herramientas de lectura funcionan. Las pruebas usan el SDK oficial en ambos protocolos.
- El catálogo canónico tiene **cero fichas publicadas y revisadas**. La ficha y los tres candidatos existentes son datos de demostración y no aparecen en MCP, JSON público, recursos ni exportaciones.
- La base D1 `PROPOSALS_DB` está configurada en el despliegue público. `proponer_candidato` guarda una propuesta privada y devuelve un ID estable. Si D1 falta en otro despliegue, el servidor responde `almacenamiento_no_configurado` y no afirma que guardó nada.
- El código de pagos permanece como prototipo opcional. Sus herramientas se ocultan del manifiesto cuando no hay configuración de pagos.
- Este repositorio no está conectado al despliegue de `qurinawi.vercel.app`. Ese sitio conserva su propio MCP anterior; usa la URL de Worker indicada arriba para la versión mejorada.

## Logo en ChatGPT

El icono cuadrado de GoldEye Trace está en `assets/goldeye-icon.png` (512 × 512 px); el original editable está en `assets/goldeye-icon.svg`. El Worker los publica en `https://goldeye-trace-mcp.pinata-server.workers.dev/icon.png` y `/icon.svg`. `npm run generar-icono` actualiza el PNG y el módulo que lo sirve tras editar el SVG.

Para corregir el icono roto que aparece junto al nombre del MCP en ChatGPT, abre **Configuración → Apps** (o **Plugins**, según la interfaz), selecciona **GoldEye Trace** y entra en **Manage/Administrar**. Si aparece el control de logo, carga `assets/goldeye-icon.png`, guarda y vuelve a abrir el chat. [OpenAI indica que el propietario puede editar el nombre y el logo desde Manage cuando esos controles están disponibles](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt). La URL `/icon.png` permite acceder al archivo, pero el logo del conector se configura en ChatGPT: publicar un favicon en el Worker no lo cambia por sí solo.

## Probar en local

Requiere Node.js 24 o posterior para las pruebas con SQLite integrado.

```powershell
npm install
npm test
npm run build
npx wrangler dev
```

En otra terminal:

```powershell
node cliente-ejemplo.mjs http://127.0.0.1:8787/mcp
```

`npm test` verifica el filtro de publicación, la cola D1 con SQLite real, las rutas públicas y la conexión desde el SDK oficial. `npm run build` comprueba que Wrangler empaqueta el Worker.

## Despliegue y cola privada

El Worker y D1 ya están desplegados. Para volver a desplegar desde este equipo, usa `npx wrangler deploy`. La base está vinculada en `wrangler.toml` y la migración aplicada. Para crear un entorno nuevo, los comandos de D1 siguen la [documentación de Cloudflare](https://developers.cloudflare.com/d1/wrangler-commands/):

```powershell
npx wrangler login
npx wrangler d1 create goldeye-propuestas --binding PROPOSALS_DB --update-config
npx wrangler d1 migrations apply goldeye-propuestas --local
npx wrangler d1 migrations apply goldeye-propuestas --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

El comando `d1 create` debe añadir `PROPOSALS_DB` a `wrangler.toml`. Lectura pública no exige clave. Las propuestas se guardan con estado `pendiente_revision`; el agente recibe un ID estable para duplicados. El secreto administrativo del despliegue actual está configurado en Cloudflare; la copia local está en `.dev.vars`, excluida de Git.

Un revisor autorizado puede consultar `GET /v1/admin/propuestas` y marcar una propuesta como `aceptada` o `rechazada` mediante `PATCH /v1/admin/propuestas/{id}` con JSON `{"estado":"aceptada","revisor":"Nombre"}`. Ambas rutas requieren `X-Admin-Token`. Aceptar la propuesta **no publica** una ficha.

## Publicar evidencia

1. Contrasta cada dato con el documento original y registra autor, fuente HTTPS, página o sección, fechas de muestreo y publicación, método, licencia, ubicación publicable, revisor, versión y permiso.
2. Edita `catalogo-canonico.json`. Una ficha se vuelve visible solo con `estado: "publicado"`, `permiso.publicacion: true` y los campos exigidos por `scripts/validar-catalogo.mjs`.
3. Ejecuta `npm run generar-publico`, `npm test` y despliega el Worker. La revisión y el cambio de estado deben quedar atribuibles en el historial del repositorio.

La proyección pública usa una lista cerrada de campos. Un permiso vencido o una ubicación marcada como restringida excluye la ficha de todas las rutas. La ausencia de resultados significa falta de fichas publicadas bajo esos filtros en este catálogo.

## Herramientas para cualquier cliente MCP

| Herramienta | Resultado |
| --- | --- |
| `buscar_estudios` | Fichas públicas por texto, matriz, ubicación y año de muestreo. |
| `obtener_ficha` | Ficha pública con fuente, página, revisor, versión y cita. |
| `listar_vacios` | Matrices sin ficha pública en el catálogo; no afirma ausencia de estudios. |
| `proponer_candidato` | Registra DOI o URL en la cola D1 privada. |
| `sugerir_valor` | Registra una sugerencia sobre una ficha pública. |

`generar_informe` y `exportar_anexo` solo se anuncian cuando se configura un medio de pago. `confirmar_campo` y `publicar_ficha` no se ofrecen a agentes. Un cliente con soporte para servidor MCP remoto puede usar la URL `/mcp`; [cliente-ejemplo.mjs](cliente-ejemplo.mjs) muestra una conexión completa con el SDK oficial.
