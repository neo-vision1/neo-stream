# Publicar no Cloudflare (plano gratuito)

O Worker entrega o painel web e mantém as conexões WebSocket do painel e do Agent em um Durable Object por local. Oracle e Vercel não são necessários.

## Implantação

No PowerShell, dentro desta pasta:

```powershell
.\deploy.ps1
```

O Wrangler abrirá o navegador para autorizar a conta Cloudflare, pedirá dois segredos e publicará o sistema:

- `AGENT_TOKEN`: usado somente pelo Agent no notebook;
- `OPERATOR_KEY`: digitado no painel pelos operadores.

Use valores longos, aleatórios e diferentes. Eles ficam como secrets no Cloudflare e não são gravados no repositório.

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
2. Informe `OBRA_001`, `CAM01` e a `OPERATOR_KEY`.
3. Inicie o Agent no notebook.
4. Confirme que Agent e câmera aparecem online.
5. Pressione uma direção e confirme que a câmera para ao soltar.

O endpoint `/health` deve responder com `{"ok":true,"service":"neo-vision-camera"}`.

## Atualizações

Após alterar o projeto:

```powershell
npm install
npm test
npm run check
npm run deploy
```
