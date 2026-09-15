$ErrorActionPreference = "Stop"

Write-Host "Instalando dependencias..."
npm install

Write-Host "Informe dois segredos diferentes e fortes. Eles nao serao salvos no GitHub."
npx wrangler secret put AGENT_TOKEN
npx wrangler secret put OPERATOR_KEY

Write-Host "Publicando Worker, Durable Object e painel..."
npx wrangler deploy

Write-Host "Concluido. Copie a URL workers.dev exibida acima para agent/config.json."
