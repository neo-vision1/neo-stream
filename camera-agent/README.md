# Neo Vision Camera Agent — Cloudflare

Controle remoto PTZ de uma câmera Intelbras por meio de um notebook Windows na mesma rede local. Funciona atrás de Starlink/CGNAT porque o notebook inicia uma conexão WebSocket de saída com o Cloudflare.

```text
Painel + WebSocket no Cloudflare -> Agent no notebook -> câmera na LAN
```

Oracle e Vercel não são necessários. O vídeo não passa pelo Agent: continue enviando-o por RTMP para o serviço de streaming e use este projeto apenas para o controle PTZ.

## O que está incluído

- Cloudflare Worker com painel e endpoint WSS.
- Durable Object por local, com hibernação WebSocket.
- Painel responsivo com UP, DOWN, LEFT, RIGHT e STOP.
- Agent Python com HTTP Digest para a câmera.
- Heartbeat, reconexão automática e estado online/offline.
- STOP ao soltar/sair do botão e timeout local de 2 segundos.
- Testes automatizados e script para gerar `.exe` no Windows.

## 1. Publicar no Cloudflare

Requer Node.js 20 ou superior para executar a implantação.

```powershell
cd cloudflare
.\deploy.ps1
```

O script configura `AGENT_TOKEN` e `OPERATOR_KEY` como secrets e publica o painel, Worker e Durable Object. Veja [as instruções completas](cloudflare/DEPLOY_CLOUDFLARE.md).

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
- IP, usuário e senha locais da câmera.

O arquivo `config.json` é ignorado pelo Git e deve ficar apenas no notebook.

## 3. Gerar o executável

Com o Agent já testado e o `config.json` preenchido:

```powershell
build_exe.bat
```

O executável será criado em `agent\dist\NeoVisionCameraAgent.exe`. Mantenha `config.json` ao lado dele.

## Teste seguro na câmera

1. Confirme que o notebook abre o endereço da câmera na rede local.
2. Execute `python test_camera.py`.
3. O teste move para a esquerda por apenas 0,3 segundo e envia STOP.
4. Se o modelo usar códigos diferentes, ajuste `ptzCodes` no `config.json` sem alterar o programa.

O driver usa o padrão CGI `/cgi-bin/ptz.cgi`, autenticação Digest e os códigos `Up`, `Down`, `Left` e `Right`. Confirme a compatibilidade com o modelo/firmware antes do uso em campo.

## Backend local legado

A pasta `backend/` mantém o protótipo Node.js apenas para testes locais. A implantação de produção usa `cloudflare/`; não é necessário manter uma VM ligada.
