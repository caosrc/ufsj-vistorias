# Deploy — Cloudflare Pages + Cloudflare Workers + D1

## Pré-requisitos
- Conta no [Cloudflare](https://dash.cloudflare.com)
- Repositório no GitHub com este projeto
- Node.js 20+ instalado localmente

---

## Passo 1 — Instalar o Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

---

## Passo 2 — Criar o banco de dados D1

```bash
npx wrangler d1 create geovistorias
```

Copie o `database_id` retornado e cole em `server/wrangler.toml`:

```toml
[[d1_databases]]
binding       = "DB"
database_name = "geovistorias"
database_id   = "COLE_AQUI_O_ID"
```

---

## Passo 3 — Criar as tabelas no banco

```bash
cd server
npm install
npx wrangler d1 execute geovistorias --remote --file=schema.sql
```

---

## Passo 4 — Deploy do Worker (API)

```bash
cd server
npx wrangler deploy
```

Anote a URL do Worker (ex: `https://geovistorias-api.SEU-USUARIO.workers.dev`).

---

## Passo 5 — Deploy do Frontend (Cloudflare Pages)

### Opção A: Via GitHub (recomendado)
1. No [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages**
2. Conecte ao repositório GitHub
3. Configure o build:
   - **Framework preset**: Vite
   - **Build command**: `cd defesa-civil && npm install && npm run build`
   - **Build output directory**: `defesa-civil/dist`
4. Adicione a variável de ambiente:
   - `VITE_API_URL` = URL do Worker do Passo 4

### Opção B: Via GitHub Actions (automático a cada push)
Adicione os seguintes segredos no repositório GitHub  
(**Settings → Secrets → Actions**):

| Segredo                   | Onde encontrar                                              |
|---------------------------|-------------------------------------------------------------|
| `CLOUDFLARE_API_TOKEN`    | Cloudflare → My Profile → API Tokens → Create Token        |
| `CLOUDFLARE_ACCOUNT_ID`   | Cloudflare Dashboard → lado direito da tela                |
| `VITE_API_URL`            | URL do Worker (ex: `https://geovistorias-api.xxx.workers.dev`) |

A cada push na branch `main`:
- Mudanças em `server/` → deploy automático do Worker
- Mudanças em `defesa-civil/` → deploy automático do Pages

---

## Passo 6 — Desenvolvimento local (opcional)

Para rodar o Worker localmente com D1 local:

```bash
cd server && npm run dev
cd defesa-civil && npm run dev
```

O Vite já está configurado para fazer proxy de `/api` para `localhost:3001`.

---

## Estrutura de URLs em produção

| Serviço         | URL                                                 |
|-----------------|-----------------------------------------------------|
| Frontend        | `https://geovistorias.pages.dev` (ou domínio custom) |
| API (Worker)    | `https://geovistorias-api.SEU-USUARIO.workers.dev`  |
