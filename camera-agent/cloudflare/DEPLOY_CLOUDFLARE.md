# Publicar no Cloudflare (plano gratuito)

O Worker entrega o painel web e mantém as conexões WebSocket do painel e do Agent em um Durable Object por local. Oracle e Vercel não são necessários.

## Implantação

No PowerShell, dentro desta pasta:

```powershell
.\deploy.ps1
```

O Wrangler abrirá o navegador para autorizar a conta Cloudflare, publicará o sistema e depois pedirá três valores:

- `AGENT_TOKEN`: usado somente pelo Agent no notebook;
- `SUPABASE_URL`: URL do projeto Supabase;
- `SUPABASE_ANON_KEY`: chave pública `Publishable` ou `anon` do projeto Supabase.

O token do Agent deve ser longo e aleatório. A URL e a chave pública do Supabase podem aparecer no navegador, mas ficam configuradas no Cloudflare e não precisam ser gravadas no repositório. Nunca use a chave `service_role` no painel.

No Supabase, mantenha o cadastro público desativado e crie os operadores em **Authentication → Users**. Somente usuários criados pela Neo Vision conseguem entrar.

## Configurar o notebook

Copie `agent/config.example.json` para `agent/config.json` e ajuste:

```json
{
  "server": "wss://neo-vision-camera.SEUSUBDOMINIO.workers.dev/ws/OBRA_001",
  "siteId": "OBRA_001",
  "agentId": "AGENT_001",
  "token": "O_MESMO_AGENT_TOKEN_DO_CLOUDFLARE"
}
```

Mantenha o restante da configuração da câmera. O local no fim da URL (`OBRA_001`) deve ser exatamente igual a `siteId`.

## Testar

1. Abra a URL `https://neo-vision-camera.SEUSUBDOMINIO.workers.dev`.
2. Entre com um usuário criado no Supabase.
3. Confirme `OBRA_001` e clique em **Conectar**.
4. Inicie o Agent no notebook.
5. Confirme que Agent e câmera aparecem online.
6. Pressione uma direção e confirme que a câmera para ao soltar.

O endpoint `/health` deve responder com `{"ok":true,"service":"neo-vision-camera"}`.

## Atualizações

Após alterar o projeto:

```powershell
npm install
npm test
npm run check
npm run deploy
```
