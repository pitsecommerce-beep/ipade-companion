# IPADE Companion — Contexto del proyecto

> Documento de contexto para agentes y desarrolladores que continúen este
> proyecto. Describe **qué se quiere lograr**, **cómo está construido** y **qué
> falta**. Mantenlo actualizado conforme evolucione la plataforma.

## 1. Propósito

**IPADE Companion** es una plataforma de acompañamiento académico para
participantes del **IPADE Business School**. El objetivo es que cada
participante pueda:

1. **Registrarse y crear su "Pasaporte IPADE"** respondiendo preguntas sobre:
   - Su persona (puesto, trayectoria, motivaciones y objetivos en el programa).
   - El contexto de su empresa (situación, retos, prioridades).
   - El contexto de su industria (dinámica competitiva, tendencias).
2. **Crear "Sesiones"** (una por caso, módulo o tema del IPADE) y dentro de
   cada una:
   - Escribir **Bitácoras** (varias notas por sesión).
   - **Cargar materiales**: PDFs de los casos de estudio, presentaciones, etc.
3. **Conversar con un agente de IA** que tiene acceso a su Pasaporte, sus
   bitácoras y los materiales de la sesión, para:
   - Resolver dudas sobre los casos y materiales.
   - **Ayudar a planear iniciativas** considerando la situación real de su
     empresa e industria (no sólo responder preguntas teóricas).

La identidad es institucional IPADE: azul marino + acento dorado, tono
académico y profesional, todo en español.

## 2. Arquitectura

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (estático)     │        │  Supabase                     │
│  React + Vite + TS       │  HTTPS │  • Auth (email/contraseña)    │
│  GitHub Pages            │ ─────▶ │  • Postgres + RLS             │
│  HashRouter              │        │  • Storage (bucket privado)   │
└──────────┬──────────────┘        │  • Edge Function "agent"      │
           │                        └───────────────┬──────────────┘
           │  supabase.functions.invoke("agent")    │
           └────────────────────────────────────────┤
                                                     │  x-api-key (secret)
                                                     ▼
                                          ┌────────────────────┐
                                          │  Claude API         │
                                          │  (Anthropic)        │
                                          └────────────────────┘
```

### Por qué este diseño

- **GitHub Pages es estático**: no puede guardar secretos ni ejecutar backend.
  Por eso la lógica de servidor (incluida la API key de Anthropic) vive en una
  **Edge Function de Supabase**. El frontend nunca ve la llave; sólo envía el
  mensaje y la sesión sobre la que se pregunta. Esto es la pieza de
  "secret actions / guardar las llaves".
- **RLS (Row Level Security)** en todas las tablas: cada participante sólo
  puede ver y editar sus propios datos. La Edge Function usa el JWT del
  usuario, así que también respeta RLS al armar el contexto del agente.

## 3. Modelo de datos (Postgres)

Ver `supabase/migrations/0001_init.sql`. Tablas (todas con `user_id` y RLS
"owner_all"):

| Tabla            | Descripción                                              |
| ---------------- | -------------------------------------------------------- |
| `passports`      | Pasaporte IPADE — 1 por usuario (perfil + contexto).     |
| `study_sessions` | Sesiones (caso/módulo/tema).                             |
| `bitacoras`      | Notas; varias por sesión (`session_id`).                 |
| `documents`      | Metadatos de materiales + `content_text` (texto extraído).|
| `agent_messages` | Historial de chat con el agente, por sesión.             |

**Storage**: bucket privado `materials`. Los archivos se guardan bajo
`materials/<user_id>/<session_id>/<archivo>` y las políticas de `storage.objects`
restringen el acceso a la carpeta del propio usuario.

## 4. El agente (Edge Function `agent`)

Archivo: `supabase/functions/agent/index.ts` (Deno).

Flujo:
1. Recibe `{ sessionId, message, history }` y el JWT del participante.
2. Crea un cliente Supabase con ese JWT (respeta RLS) y lee:
   - El Pasaporte del usuario.
   - Las bitácoras de la sesión.
   - El `content_text` de los documentos de la sesión.
3. Arma un **system prompt** institucional + el contexto, y llama a la API de
   Claude (`claude-opus-4-8`, *adaptive thinking*).
4. Devuelve `{ reply }`.

Notas:
- Hay límites defensivos de caracteres para no exceder el contexto/tokens.
- La extracción de texto de PDFs se hace en el **navegador** (`src/lib/pdf.ts`
  con `pdfjs-dist`) al subir el archivo, y se guarda en `documents.content_text`.
  Las presentaciones (.pptx) y otros formatos se almacenan pero **no** se
  extrae su texto todavía (ver pendientes).

## 5. Frontend

- `src/main.tsx` — entrada; `HashRouter` (evita 404 al recargar en Pages).
- `src/App.tsx` — layout institucional, rutas y guardas (`ConfigGuard`,
  `Protected`).
- `src/context/AuthContext.tsx` — sesión de Supabase Auth.
- `src/pages/`
  - `Login.tsx` — alta/ingreso.
  - `Passport.tsx` — formulario del Pasaporte IPADE.
  - `Dashboard.tsx` — lista y creación de sesiones.
  - `SessionDetail.tsx` — pestañas **Bitácoras / Materiales / Agente**.
- `src/lib/` — `supabase.ts`, `agent.ts`, `pdf.ts`, `types.ts`.
- `src/index.css` — identidad visual IPADE.

## 6. Despliegue

- **Frontend** → GitHub Pages vía Actions (`.github/workflows/deploy.yml`).
  Variables de repo: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
  `base` de Vite = `/ipade-companion/` (nombre del repo).
- **Backend** → Supabase: aplicar la migración, desplegar la Edge Function y
  configurar el secret `ANTHROPIC_API_KEY`. Ver `README.md`.

## 7. Estado actual / pendientes

Implementado:
- Auth, Pasaporte, Sesiones, Bitácoras, carga de materiales (con extracción de
  texto de PDFs), chat con el agente y persistencia del historial.
- RLS, Storage privado, workflow de Pages, Edge Function del agente.

Pendientes / mejoras sugeridas:
- Extraer texto de `.pptx` / `.docx` (hoy sólo PDFs).
- Búsqueda semántica (embeddings) cuando los materiales crezcan; hoy se manda
  el texto recortado por límites de caracteres.
- Streaming de la respuesta del agente (hoy es una sola respuesta).
- Compartir/colaborar entre participantes (hoy todo es privado por usuario).
- Confirmación de correo y recuperación de contraseña (configurable en Supabase).
- Code-splitting del bundle (pdfjs lo hace grande).

## 8. Decisiones a recordar

- **Nunca** poner la API key de Anthropic en el frontend ni en variables
  `VITE_*`: va sólo en los secrets de la Edge Function.
- Modelo por defecto: `claude-opus-4-8` con *adaptive thinking*. Si se cambia,
  hacerlo en `supabase/functions/agent/index.ts` (constante `MODEL`).
- Todo el producto es en **español** y con marca **IPADE Companion**.
