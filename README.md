# IPADE Companion

Plataforma de acompañamiento académico para participantes del **IPADE Business
School**. Permite crear un **Pasaporte IPADE** (perfil personal + contexto de
empresa e industria), gestionar **Sesiones** con **Bitácoras** y **materiales**
(PDFs de casos, presentaciones), y conversar con un **agente de IA** que conoce
todo ese contexto para resolver dudas y ayudar a planear iniciativas.

- **Frontend**: React + Vite + TypeScript, desplegado en **GitHub Pages**.
- **Backend**: **Supabase** (Auth, Postgres con RLS, Storage) + una **Edge
  Function** que llama a la **API de Claude** (Anthropic) guardando la API key
  como secret.

> Para el contexto completo del proyecto (qué se quiere lograr, decisiones de
> diseño y pendientes), lee [`docs/CONTEXT.md`](docs/CONTEXT.md).

---

## Requisitos

- Node.js 20+
- Una cuenta de [Supabase](https://supabase.com)
- Una API key de [Anthropic](https://console.anthropic.com)
- (Para el backend) la [CLI de Supabase](https://supabase.com/docs/guides/cli)

## 1. Configurar Supabase

1. Crea un proyecto en Supabase y anota su **Project URL** y **anon key**
   (Settings → API).
2. Aplica el esquema y las políticas. Opción A (SQL Editor): copia y ejecuta el
   contenido de [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   Opción B (CLI):
   ```bash
   supabase link --project-ref <TU_PROJECT_REF>
   supabase db push
   ```
3. Despliega la Edge Function del agente y configura el secret con tu API key.
   Puedes hacerlo manualmente:
   ```bash
   supabase functions deploy agent
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
   ```
   …o automáticamente desde CI (recomendado): ver
   [§ Desplegar el backend desde GitHub Actions](#4-desplegar-el-backend-desde-github-actions).
   (`SUPABASE_URL` y `SUPABASE_ANON_KEY` se inyectan automáticamente.)

## 2. Desarrollo local

```bash
npm install
cp .env.example .env.local   # y completa los valores
npm run dev
```

`.env.local`:

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-publica
```

> Sólo van aquí las claves **públicas** (URL y anon key). La `ANTHROPIC_API_KEY`
> **nunca** va en el frontend: vive en los secrets de la Edge Function.

## 3. Desplegar en GitHub Pages

1. Sube el repositorio a GitHub (debe llamarse `ipade-companion` para que el
   `base` de Vite coincida; si usas otro nombre, ajusta `VITE_BASE`).
2. En **Settings → Pages**, en *Build and deployment* selecciona **GitHub
   Actions** como *Source*.
3. En **Settings → Secrets and variables → Actions → Variables**, crea:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Haz push a `main`. El workflow
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) construye y
   publica el sitio en `https://<usuario>.github.io/ipade-companion/`.

## 4. Desplegar el backend desde GitHub Actions

El workflow [`.github/workflows/deploy-supabase.yml`](.github/workflows/deploy-supabase.yml)
despliega la Edge Function y configura su secret `ANTHROPIC_API_KEY` tomándolo
de los **Actions Secrets**. La llave viaja de *Actions Secrets* al secret de la
Edge Function en Supabase y **nunca** entra al build del frontend.

En **Settings → Secrets and variables → Actions → Secrets**, crea:

| Secret                  | Valor                                                        |
| ----------------------- | ------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`     | Tu API key de Anthropic (`sk-ant-…`).                        |
| `SUPABASE_ACCESS_TOKEN` | Token personal de la CLI de Supabase (Account → Access Tokens). |
| `SUPABASE_PROJECT_REF`  | El *ref* del proyecto (Settings → General → Reference ID).   |

El workflow corre al hacer push a `main` con cambios en `supabase/**`, o
manualmente desde la pestaña **Actions** (*Run workflow*).

> ⚠️ **Importante:** `ANTHROPIC_API_KEY` va en *Actions **Secrets***, no en
> *Variables*, y **jamás** debe pasarse como variable `VITE_*` al build del
> frontend (quedaría expuesta en el JavaScript público). Solo el workflow de
> backend la usa.

## 5. Uso

1. Crea tu cuenta e inicia sesión.
2. Completa tu **Pasaporte IPADE**.
3. Crea una **Sesión** (un caso o módulo).
4. Dentro de la sesión: escribe **Bitácoras**, sube **Materiales** y consulta
   al **Agente**.

## Scripts

| Comando             | Acción                                  |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Servidor de desarrollo (Vite).          |
| `npm run build`     | Compila TypeScript y genera `dist/`.    |
| `npm run preview`   | Sirve el build de producción localmente.|
| `npm run typecheck` | Verifica tipos sin emitir.              |

## Estructura

```
.
├─ .github/workflows/deploy.yml   # Despliegue a GitHub Pages
├─ docs/CONTEXT.md                # Contexto del proyecto (léelo)
├─ src/                           # Frontend React
│  ├─ pages/                      # Login, Passport, Dashboard, SessionDetail
│  ├─ lib/                        # supabase, agent, pdf, types
│  └─ context/AuthContext.tsx
└─ supabase/
   ├─ migrations/0001_init.sql    # Esquema + RLS + Storage
   └─ functions/agent/index.ts    # Edge Function (agente Claude)
```

---

IPADE Companion · herramienta de apoyo para participantes del IPADE Business School.
