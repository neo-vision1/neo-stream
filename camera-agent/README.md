# Neo Vision Camera Agent — MVP

Controle remoto PTZ de uma câmera Intelbras por meio de um notebook Windows na mesma rede local. Funciona atrás de Starlink/CGNAT porque o notebook inicia uma conexão WebSocket de saída com o servidor.

```text
Painel web -> Backend HTTPS/WSS -> Agent no notebook -> câmera na LAN
```

O vídeo não passa pelo Agent. Continue enviando o vídeo da câmera por RTMP para o serviço de streaming e use este projeto apenas para o controle PTZ.

## O que está incluído

- Painel responsivo com UP, DOWN, LEFT, RIGHT e STOP.
- Backend Node.js com API REST e WebSocket.
- Agent Python com HTTP Digest para a câmera.
- Heartbeat, reconexão automática e estado online/offline.
- STOP ao soltar/sair do botão e timeout local de 2 segundos.
- Testes automatizados e script para gerar `.exe` no Windows.

## 1. Backend

Requer Node.js 20 ou superior.

```powershell
cd backend
copy .env.example .env
npm install
npm test
npm start
```

Edite `.env` e troque obrigatoriamente os dois segredos. Em produção, publique atrás de HTTPS; o WebSocket será `wss://` automaticamente.

Abra `http://localhost:8080`, informe a chave do operador e use o painel.

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

- endereço `ws://` de teste ou `wss://` de produção;
- o mesmo `AGENT_TOKEN` do backend;
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

## Implantação inicial

Para publicar em uma VM Oracle Cloud gratuita com HTTPS/WSS automático, siga [`deploy/DEPLOY_ORACLE.md`](deploy/DEPLOY_ORACLE.md). Libere somente SSH, HTTP e HTTPS na VM. Não libere a câmera nem o notebook diretamente.

O MVP mantém sessões em memória. Reiniciar o backend desconecta os Agents, que se reconectam automaticamente.
