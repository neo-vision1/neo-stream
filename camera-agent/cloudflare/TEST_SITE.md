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
- layout horizontal para celular, com a grade em largura total, faixa rolável de câmeras e distribuição automática em 2, 3 ou 4 colunas;
- compatibilidade móvel sem depender de `:has()`: a quantidade de colunas usa um atributo explícito, e a faixa de câmeras fica fixa abaixo dos vídeos com suporte à área segura do iOS;
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

O perfil `admin` sempre tem PTZ, áudio e acesso às 11 câmeras, independentemente do limite individual gravado anteriormente. Alterações de acesso são confirmadas pelo Supabase e reaplicadas ao usuário ao entrar, ao voltar para a aba e, enquanto a página estiver visível, a cada 30 segundos. Ao conceder a um usuário um limite multicâmera maior que o limite geral atual, o limite geral é elevado automaticamente; os outros usuários continuam respeitando seus limites individuais.

Se o esquema já foi aplicado antes desta atualização, execute o arquivo novamente. Ele é idempotente e criará `viewer_preferences`, ajustará os padrões seguros e removerá PTZ/áudio dos perfis que ainda são `viewer`.

## Consumo do Mux

O valor exibido no painel é uma estimativa local da sessão. A leitura oficial da conta Mux ainda depende de credenciais de API guardadas como segredos no Cloudflare e não deve ser feita diretamente no navegador.

## Alertas de indisponibilidade

O painel Admin permite configurar:

- monitoramento ligado/desligado;
- prazo de 1, 2, 5, 10 ou 15 minutos;
- e-mail de destino;
- alerta de recuperação;
- alerta único para queda do Agent/internet;
- histórico das 100 últimas ocorrências;
- envio de alerta de teste.

As regras evitam repetição: uma câmera gera um aviso ao ultrapassar o prazo e outro somente quando recuperar. Quando o Agent para de comunicar, é emitido um único alerta geral em vez de um alerta para cada câmera.

No Worker de teste, as configurações, o histórico e o botão de teste podem ser validados, mas o estado real das câmeras continua chegando ao Worker de produção. O monitoramento real começa apenas depois da promoção aprovada dessa versão.

Para habilitar o e-mail, primeiro ative o Email Service/Email Routing do domínio na Cloudflare e verifique o destinatário. Depois adicione ao Worker um binding `send_email` chamado `ALERT_EMAIL`, limitado ao endereço verificado. O remetente padrão preparado é `alerts@neovision-es.com.br` e também precisa pertencer a um domínio habilitado para envio. Sem esse binding, os eventos são registrados com o estado `not_configured`, sem tentativa externa.

## Validação

```powershell
cd camera-agent\cloudflare
npm test
npm run check -- --config wrangler.test.jsonc
npx wrangler deploy --config wrangler.test.jsonc
```

Antes da publicação em produção, validar desktop, celular, PTZ, áudio, tela cheia, retorno ao vivo, limites da grade e permissões de cada perfil.
