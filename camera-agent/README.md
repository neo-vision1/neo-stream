# Neo Vision Camera Agent — Cloudflare

Monitoramento Mux e controle remoto PTZ de até 11 câmeras Intelbras por meio de um notebook Windows na mesma rede local. Funciona atrás de Starlink/CGNAT porque o notebook inicia uma conexão WebSocket de saída com o Cloudflare.

```text
Painel com vídeo Mux + WebSocket no Cloudflare -> Agent no notebook -> câmeras na LAN
```

Oracle e Vercel não são necessários. Cada câmera envia o vídeo por RTMP ao Mux, e o painel incorpora o respectivo Playback ID. O vídeo não passa pelo Agent; o Agent transporta somente status e comandos PTZ.

## O que está incluído

- Cloudflare Worker com painel e endpoint WSS.
- Durable Object por local, com hibernação WebSocket.
- Um único painel responsivo com lista de câmeras, vídeo Mux e UP, DOWN, LEFT, RIGHT e STOP.
- Agent Python com HTTP Digest para a câmera.
- Heartbeat individual das câmeras, reconexão automática e estado online/offline.
- STOP ao soltar/sair do botão e timeout local de 2 segundos.
- Testes automatizados e script para gerar `.exe` no Windows.

## 1. Publicar no Cloudflare

Requer Node.js 20 ou superior para executar a implantação.

```powershell
cd cloudflare
.\deploy.ps1
```

O script configura `AGENT_TOKEN` e `OPERATOR_KEY` como secrets e publica o painel, Worker e Durable Object. Veja [as instruções completas](cloudflare/DEPLOY_CLOUDFLARE.md).

Para atualizar uma instalação existente da Neo Vision com os oito IPs já conhecidos e os 11 Playback IDs, pare o Agent e execute `upgrade_known_cameras.ps1` na raiz de `camera-agent`. O script cria backup do `config.json`, preserva os segredos locais, atualiza os arquivos e executa `wrangler deploy`.

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

O formato antigo com uma propriedade `camera` continua aceito durante a migração. Para múltiplas câmeras, use o formato `cameraDefaults` + `cameras` de `agent/config.example.json`.

## 3. Vídeo Mux no mesmo painel

Edite `cloudflare/public/cameras.js` e informe somente o **Playback ID público** de cada transmissão:

```js
{ id: "CAM01", name: "Câmera 01", playbackId: "PLAYBACK_ID_DO_MUX" }
```

Não coloque a Stream Key RTMP nesse arquivo. A câmera usa RTMP URL + Stream Key para enviar; o navegador usa apenas o Playback ID para assistir. O painel incorpora o player web oficial do Mux e associa o vídeo ao mesmo ID lógico usado pelo PTZ.

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

## Teste seguro nas câmeras

1. Confirme que o notebook abre o endereço da câmera na rede local.
2. Confirme no `config.json` o ID, IP e `channel: 1`.
3. Execute `python test_camera.py`, informe o ID e confirme com ENTER.
4. O teste move para a esquerda por apenas 0,3 segundo e envia STOP.
5. Se o modelo usar códigos diferentes, ajuste `ptzCodes` no `config.json` sem alterar o programa.

O driver usa o padrão CGI `/cgi-bin/ptz.cgi`, autenticação Digest e os códigos `Up`, `Down`, `Left` e `Right`. O comando recebido para `CAM01` nunca é enviado a outra câmera: o Agent seleciona o equipamento pelo ID lógico.

## Backend local legado

A pasta `backend/` mantém o protótipo Node.js apenas para testes locais. A implantação de produção usa `cloudflare/`; não é necessário manter uma VM ligada.
