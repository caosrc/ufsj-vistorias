---
name: http-proxy-middleware v3 pathFilter
description: A opção `filter` foi removida na v3 do http-proxy-middleware; sem ela todas as rotas são proxiadas, inclusive /api, quebrando o backend.
---

## Regra

Na versão 3.x do `http-proxy-middleware`, a opção `filter` foi renomeada para `pathFilter` e tem assinatura diferente. Se você usar `filter:` na v3, ela é silenciosamente ignorada e TODAS as requisições (incluindo /api) são proxiadas para o Vite.

**Why:** O bug se manifestava assim: `curl localhost:5000/api/auth/login` retornava `{"ok":true}` (Express matchava a rota antes do proxy middleware), mas `/api/health` retornava HTML do Vite (sem rota Express, caía no proxy sem filtro).

**How to apply:** Em vez de usar `filter` ou `pathFilter` no objeto de opções, use um middleware wrapper customizado:

```js
const viteProxy = createProxyMiddleware({
  target: 'http://localhost:5173',
  changeOrigin: true,
  ws: true,
  on: { error: (_err, _req, res) => res.status(502).send('Vite indisponível') }
})

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  viteProxy(req, res, next)
})
```

Isso garante que rotas `/api/*` nunca chegam ao proxy, independente da versão do pacote.
