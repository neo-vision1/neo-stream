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
- gestão de função, PTZ, áudio e limite multicâmera por perfil;
- seleção da grade salva por usuário e botão para limpar a grade;
- permissões sensíveis negadas por padrão e preparadas para validação também no Worker.

## Segurança e isolamento

- O arquivo `wrangler.test.jsonc` publica outro Worker.
- O teste usa a Service Binding `CONTROL_WORKER` para encaminhar login e WebSocket ao controle já existente.
- IPs, senhas das câmeras e stream keys não são enviados ao navegador.
- A grade nunca inicia todas as câmeras automaticamente.
- Configurações e nomes usam RLS no Supabase.

## Preparação do Supabase

1. Abra o SQL Editor do projeto de teste.
2. Execute `supabase-test-schema.sql`.
3. Substitua o e-mail do exemplo no último comando e promova somente a conta administradora.
4. Entre no site de teste e confirme que o botão **Admin** aparece.
5. Abra **Admin > Perfis e permissões** e defina explicitamente os acessos de cada usuário.

Contas novas entram como `viewer`, sem PTZ e sem falar na câmera. A conta que está usando o painel administrativo não pode alterar a si própria nessa tela, evitando a remoção acidental do único administrador.

Se o esquema já foi aplicado antes desta atualização, execute o arquivo novamente. Ele é idempotente e criará `viewer_preferences`, ajustará os padrões seguros e removerá PTZ/áudio dos perfis que ainda são `viewer`.

## Consumo do Mux

O valor exibido no painel é uma estimativa local da sessão. A leitura oficial da conta Mux ainda depende de credenciais de API guardadas como segredos no Cloudflare e não deve ser feita diretamente no navegador.

## Validação

```powershell
cd camera-agent\cloudflare
npm test
npm run check -- --config wrangler.test.jsonc
npx wrangler deploy --config wrangler.test.jsonc
```

Antes da publicação em produção, validar desktop, celular, PTZ, áudio, tela cheia, retorno ao vivo, limites da grade e permissões de cada perfil.
