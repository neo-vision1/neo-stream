# Implantar o backend na Oracle Cloud Free Tier

Este roteiro publica o painel e o WebSocket em:

```text
https://controle.neovision-es.com.br
wss://controle.neovision-es.com.br/agent
```

## 1. Criar a VM

No painel da Oracle Cloud:

1. Acesse **Compute > Instances > Create instance**.
2. Nome: `neo-vision-server`.
3. Imagem: **Ubuntu 24.04 LTS**.
4. Shape: uma opção marcada como **Always Free Eligible**.
5. Selecione ou gere uma chave SSH e guarde a chave privada.
6. Habilite um endereço IPv4 público.
7. Crie a instância e anote o IP público.

Se a Oracle informar falta de capacidade, tente outro domínio de disponibilidade ou aguarde e tente novamente.

## 2. Liberar somente as portas necessárias

Na Security List ou Network Security Group da VM, permita entrada TCP:

| Porta | Origem | Uso |
| --- | --- | --- |
| 22 | seu IP, se possível | SSH |
| 80 | `0.0.0.0/0` | validação HTTPS |
| 443 | `0.0.0.0/0` | painel e WSS |

Não libere a porta 8080. Ela existe apenas dentro do Docker.

## 3. Configurar o DNS

No provedor DNS de `neovision-es.com.br`, crie:

```text
Tipo: A
Nome: controle
Valor: IP_PUBLICO_DA_VM
TTL: automático ou 300
```

Aguarde até `controle.neovision-es.com.br` resolver para o IP da VM.

## 4. Instalar Docker na VM

Conecte por SSH e execute:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git openssl
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Saia do SSH e entre novamente para aplicar o grupo `docker`.

## 5. Baixar e configurar o projeto

Como o repositório é privado, autentique o GitHub quando solicitado:

```bash
git clone https://github.com/neo-vision1/neo-stream.git
cd neo-stream/camera-agent/deploy
chmod +x generate-env.sh
./generate-env.sh
```

Abra `.env`, confira o domínio e copie para um lugar seguro o `AGENT_TOKEN` e a `OPERATOR_KEY`:

```bash
nano .env
```

O `AGENT_TOKEN` também será usado no `config.json` do notebook. A `OPERATOR_KEY` será informada no painel web.

## 6. Iniciar

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

O Caddy solicitará e renovará automaticamente o certificado HTTPS quando o DNS e as portas estiverem corretos.

Teste:

```text
https://controle.neovision-es.com.br/health
```

Resultado esperado:

```json
{"status":"ok"}
```

## 7. Atualizar futuramente

```bash
cd ~/neo-stream
git pull
cd camera-agent/deploy
docker compose up -d --build
```

## 8. Próxima configuração no notebook

No `agent/config.json`, use:

```json
"server": "wss://controle.neovision-es.com.br/agent"
```

Copie exatamente o `AGENT_TOKEN` criado na VM. Nunca envie o arquivo `config.json` ao GitHub.

