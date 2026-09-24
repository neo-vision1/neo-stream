# Neo Vision Camera Agent — Cloudflare

Monitoramento Mux e controle remoto PTZ de até 11 câmeras Intelbras por meio de um notebook Windows na mesma rede local. Funciona atrás de Starlink/CGNAT porque o notebook inicia uma conexão WebSocket de saída com o Cloudflare.

```text
Painel com vídeo Mux + WebSocket no Cloudflare -> Agent no notebook -> câmeras na LAN
```

Oracle e Vercel não são necessários. Cada câmera envia o vídeo por RTMP ao Mux, e o painel incorpora o respectivo Playback ID. O vídeo não passa pelo Agent; o Agent transporta somente status e comandos PTZ.

## O que está incluído

- Cloudflare Worker com painel e endpoint WSS.
- Durable Object por local, com hibernação WebSocket.
- Um único painel responsivo com opções Câmeras e Drone, vídeo Mux, grade mista e controles PTZ para as câmeras.
- Login por e-mail e senha com Supabase Auth; o Worker valida a sessão antes de aceitar comandos PTZ.
- Agent Python com CGI/Digest para modelos legados e ONVIF para a iM7+ Zoom Full Color.
- Heartbeat individual das câmeras, reconexão automática e estado online/offline.
- STOP ao soltar/sair do botão e timeout local de 2 segundos.
- Testes automatizados e script para gerar `.exe` no Windows.

## 1. Publicar no Cloudflare

Requer Node.js 20 ou superior para executar a implantação.

```powershell
cd cloudflare
.\deploy.ps1
```

O script configura `AGENT_TOKEN`, `SUPABASE_URL` e `SUPABASE_ANON_KEY` no Cloudflare e publica o painel, Worker e Durable Object. Veja [as instruções completas](cloudflare/DEPLOY_CLOUDFLARE.md).

Para atualizar uma instalação existente da Neo Vision com os dez IPs já conhecidos e os 11 Playback IDs, pare o Agent e execute `upgrade_known_cameras.ps1` na raiz de `camera-agent`. O script cria backup do `config.json`, preserva os segredos locais, atualiza os arquivos e executa `wrangler deploy`. A CAM11 permanece somente com vídeo até o IP local ser informado.

## 2. Agent no notebook da câmera

Requer Python 3.11 ou superior durante o teste inicial.

```powershell
cd agent
copy config.example.json config.json
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m unittest discover -s tests -v
python agent.py
```

Preencha `config.json` com:

- URL `wss://...workers.dev/ws/OBRA_001` publicada pelo Cloudflare;
- o mesmo `AGENT_TOKEN` configurado como secret no Cloudflare;
- os 11 IDs e IPs locais das câmeras;
- usuário/senha compartilhados em `cameraDefaults`, ou substituições individuais quando necessário;
- `channel: 1`, confirmado para o modelo Intelbras testado.

O arquivo `config.json` é ignorado pelo Git e deve ficar apenas no notebook.

### iM7+ Zoom Full Color (PTZ e zoom)

Na entrada da câmera correspondente, use `"ptzProtocol": "onvif"`, porta
`onvifPort` (normalmente 80), usuário `admin` e a chave de acesso impressa na
etiqueta como senha. Ative ONVIF no aplicativo/configuração da câmera, se essa
opção aparecer, e reserve um IP fixo no roteador. Não envie essa chave ao site,
ao Cloudflare ou ao GitHub.

O Agent consulta as capacidades ONVIF da câmera. Os botões `Zoom −` e
`Zoom +` só ficam ativos quando a câmera selecionada está online e anuncia
zoom contínuo. O STOP interrompe simultaneamente pan, tilt e zoom, e o timeout
local continua protegendo contra movimento preso após perda de conexão.

Antes de publicar para todos os usuários, execute `python test_im7_onvif.py`.
O utilitário pede confirmação antes de cada ação, move e aproxima por somente
0,3 segundo e sempre envia STOP ao terminar.

O formato antigo com uma propriedade `camera` continua aceito durante a migração. Para múltiplas câmeras, use o formato `cameraDefaults` + `cameras` de `agent/config.example.json`.

## 3. Vídeo Mux no mesmo painel

Edite `cloudflare/public/cameras.js` e informe somente o **Playback ID público** de cada transmissão:

```js
{ id: "CAM01", name: "Câmera 01", playbackId: "PLAYBACK_ID_DO_MUX" }
```

Não coloque a Stream Key RTMP nesse arquivo. A câmera usa RTMP URL + Stream Key para enviar; o navegador usa apenas o Playback ID para assistir. O painel incorpora o player web oficial do Mux e associa o vídeo ao mesmo ID lógico usado pelo PTZ.

O mesmo arquivo também aceita transmissões de drone em `NEO_VISION_DRONES`.
O drone aparece em uma opção separada no painel, não recebe comandos PTZ do
Agent e pode ser reproduzido sozinho ou junto com câmeras no modo grade. A
grade mantém o limite simultâneo configurado pelo administrador.

Depois, publique novamente:

```powershell
cd cloudflare
npx wrangler deploy
```

## 4. Gerar o executável

Com o Agent já testado e o `config.json` preenchido:

```powershell
build_exe.bat
```

O executável será criado em `agent\dist\NeoVisionCameraAgent.exe`. Mantenha `config.json` ao lado dele.

## 5. Iniciar automaticamente com o Windows

Com o Agent instalado em `%LOCALAPPDATA%\NeoVisionAgent`, execute `install_autostart.ps1`. O script cria a tarefa agendada `NeoVisionCameraAgent`, que inicia o Agent oculto após o login do usuário e tenta reiniciá-lo em caso de falha.

O log fica em `%LOCALAPPDATA%\NeoVisionAgent\agent-autostart.log`. Para consultar o estado:

```powershell
Get-ScheduledTask -TaskName "NeoVisionCameraAgent"
Get-ScheduledTaskInfo -TaskName "NeoVisionCameraAgent"
```

Para parar ou remover a inicialização automática:

```powershell
Stop-ScheduledTask -TaskName "NeoVisionCameraAgent"
Unregister-ScheduledTask -TaskName "NeoVisionCameraAgent" -Confirm:$false
```

## Teste seguro nas câmeras

1. Confirme que o notebook abre o endereço da câmera na rede local.
2. Confirme no `config.json` o ID, IP e `channel: 1`.
3. Execute `python test_camera.py`, informe o ID e confirme com ENTER.
4. O teste move para a esquerda por apenas 0,3 segundo e envia STOP.
5. Se o modelo usar códigos diferentes, ajuste `ptzCodes` no `config.json` sem alterar o programa.

O driver usa o padrão CGI `/cgi-bin/ptz.cgi`, autenticação Digest e os códigos `Up`, `Down`, `Left` e `Right`. O comando recebido para `CAM01` nunca é enviado a outra câmera: o Agent seleciona o equipamento pelo ID lógico.

## Áudio no Mux via notebook

A VIP 1300 MINI SD envia vídeo no RTMP nativo, mas o firmware testado não inclui
a faixa de áudio nessa saída. O Agent pode iniciar um relay FFmpeg usando o
Stream Extra por RTSP. Para tolerar timestamps incompletos da câmera e pequenas
oscilações de conexões móveis ou Starlink, o relay gera novos timestamps,
recodifica o vídeo em H.264 com fluxo controlado e envia ao Mux por RTMPS/443.
O padrão de campo é 20 fps, 1.200 kbps, pico de 1.500 kbps e áudio AAC de
64 kbps. Esses valores podem ser ajustados por câmera com `relayFps`,
`relayVideoBitrateKbps` e `relayMaxBitrateKbps` no `config.json`.

Execute `configure_audio_relay.ps1 -CameraId CAM01` no notebook e informe a
Stream Key apenas no prompt protegido. As chaves são armazenadas localmente em
`%LOCALAPPDATA%\NeoVisionAgent\mux_keys.json` e nunca devem ser enviadas ao
GitHub. O relay reinicia automaticamente após quedas e grava seu diagnóstico em
`logs\relay-CAM01.log`. Mantenha o RTMP nativo desativado nas câmeras que
usarem o relay para não haver dois transmissores com a mesma Stream Key.

Cada Stream Key presente em `mux_keys.json` inicia um relay próprio. Durante a
validação em campo, mantenha apenas a CAM01 configurada. Antes de habilitar as
11 transmissões, implemente ativação sob demanda ou dimensione upload e CPU
para a soma de todos os relays. O recurso de ouvir/falar é independente: apenas
a câmera selecionada abre uma sessão NetSDK de retorno de áudio.

## Backend local legado

A pasta `backend/` mantém o protótipo Node.js apenas para testes locais. A implantação de produção usa `cloudflare/`; não é necessário manter uma VM ligada.
