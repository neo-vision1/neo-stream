# Ambiente de teste do painel Neo Vision

O ambiente de teste usa o Worker `neo-vision-camera-test` e nunca substitui o Worker de produção.

## Recursos em validação

- tela cheia do vídeo ou da grade;
- indicador `AO VIVO` / `ATRASADO` e retorno ao ponto ao vivo;
- linha do tempo curta da live;
- grade selecionável com limite administrativo de 1, 2, 4, 6, 9 ou 11 câmeras;
- pausa quando a aba fica oculta ou inativa;
- estimativa de minutos entregues pelo Mux na sessão;
- nomes de câmera por perfil;
- funções `admin`, `operator` e `viewer`.

## Segurança e isolamento

- O arquivo `wrangler.test.jsonc` publica outro Worker.
- O teste usa `CONTROL_ORIGIN` apenas para encaminhar login e WebSocket ao controle já existente.
- IPs, senhas das câmeras e stream keys não são enviados ao navegador.
- A grade nunca inicia todas as câmeras automaticamente.
- Configurações e nomes usam RLS no Supabase.

## Preparação do Supabase

1. Abra o SQL Editor do projeto de teste.
2. Execute `supabase-test-schema.sql`.
3. Substitua o e-mail do exemplo no último comando e promova somente a conta administradora.
4. Entre no site de teste e confirme que o botão **Admin** aparece.

## Validação

```powershell
cd camera-agent\cloudflare
npm test
npm run check -- --config wrangler.test.jsonc
npx wrangler deploy --config wrangler.test.jsonc
```

Antes da publicação em produção, validar desktop, celular, PTZ, áudio, tela cheia, retorno ao vivo, limites da grade e permissões de cada perfil.
