## Deploy (Supabase + Render + Vercel)

Esta repo tem:
- `backend/` (Node/Express + Prisma + auth cookies)
- `frontend/` (Vite + React)
- DB já está no Supabase (Postgres)

Objetivo:
- Frontend: Vercel
- Backend: Render
- DB: Supabase

> Nota importante (cookies/auth):
> O frontend usa cookies httpOnly (`credentials: "include"`) para refresh token.
> Para isto funcionar bem em iOS/Safari, o ideal é o browser falar sempre com o MESMO origin do frontend.
> Por isso, em produção, usa **Vercel rewrites** para fazer proxy de `/api/*` e `/media/*` para o Render.

---

### 1) Supabase (DB)

No Supabase, vai buscar:
- **Transaction pooler** (pgBouncer, normalmente porta `6543`) → usar como `DATABASE_URL` (runtime).
- **Direct connection** (porta `5432`) → usar como `DIRECT_URL` (migrations do Prisma).

Se não tiveres, vai a:
`Project Settings` → `Database` → `Connection string`.

---

### 2) Backend no Render

1. Render → **New** → **Web Service**
2. Liga ao GitHub e escolhe este repo
3. Em **Root Directory**, escolhe `backend`
4. Runtime: Node
5. **Build Command** (sugestão):
   - `npm ci && npx prisma generate && npx prisma migrate deploy`
6. **Start Command**:
   - `node server.js`

#### Variáveis de ambiente (Render)

Obrigatórias para arrancar:
- `NODE_ENV=production`
- `JWT_SECRET=...` (gera um valor forte, 32+ chars)
- `DATABASE_URL=...` (pooler Supabase recomendado)
- `DIRECT_URL=...` (direct Supabase para migrations)

Recomendadas:
- `APP_URL=https://<teu-dominio-vercel>`  
  Ex: `https://coreai-web.vercel.app`
- `API_URL=https://<teu-dominio-vercel>/api`  
  (isto é crítico para links de email + OAuth callbacks funcionarem via proxy do Vercel)
- `CORS_ORIGINS=https://<teu-dominio-vercel>`  
  (podes meter mais do que um separado por vírgulas)

Email (para registo/verificação funcionar):
- `SENDGRID_API_KEY=...`
- `SENDGRID_FROM=Core AI <no-reply@teudominio.com>` (opcional)

Providers AI (mínimo 1 se queres usar chat/creative):
- `OPENAI_API_KEY=...` (e/ou GEMINI/ANTHROPIC/XAI/etc)

Depois do deploy, guarda o URL do Render (ex.: `https://coreai-backend.onrender.com`).

---

### 3) Frontend no Vercel

1. Vercel → **Add New...** → **Project**
2. Importa o mesmo repo
3. Em **Root Directory**, escolhe `frontend`
4. Framework: Vite (auto-detecta)
5. Build: `npm run build`
6. Output: `dist`

#### Variáveis de ambiente (Vercel)

Estas são importantes para OAuth ir pelo proxy e não “saltar” para o Render:
- `VITE_API_URL=/api` (podes nem precisar, é default)
- `VITE_OAUTH_URL=/api`

---

### 4) Rewrites no Vercel (para /api e /media)

Opção A (recomendada): criar `vercel.json` com rewrites.

Vê `vercel.json.example` e copia para `vercel.json`, trocando o domínio do Render.

Opção B: Vercel UI → Project Settings → Rewrites.

Regras:
- `/api/(.*)` → `https://<teu-render>/$1`
- `/media/(.*)` → `https://<teu-render>/media/$1`

Isto garante:
- chamadas `fetch("/api/...")` funcionam
- cookies ficam no domínio do Vercel (bom para iOS/Safari)
- OAuth callbacks podem ser `https://<vercel>/api/auth/...`

---

### 5) OAuth (Google/Apple) — se usares

Como o proxy é no Vercel:
- Configura as redirect URIs no provider para apontarem para:
  - `https://<vercel>/api/auth/google/callback`
  - `https://<vercel>/api/auth/apple/callback`

E no Render garante:
- `API_URL=https://<vercel>/api`
- `APP_URL=https://<vercel>`

---

### 6) Checklist rápido

- [ ] Render: service online, `node server.js` a correr
- [ ] Render: `JWT_SECRET`, `DATABASE_URL`, `DIRECT_URL` set
- [ ] Render: `APP_URL` e `API_URL` a apontar para Vercel
- [ ] Vercel: root `frontend`, build ok
- [ ] Vercel: rewrites `/api` e `/media` ativos
- [ ] Registo/login funciona (cookies persistem em iOS)

