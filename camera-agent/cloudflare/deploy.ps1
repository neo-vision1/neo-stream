$ErrorActionPreference = "Stop"

Write-Host "Instalando dependencias..."
npm install

Write-Host "Criando o Worker, Durable Object e painel..."
npx wrangler deploy

Write-Host "Informe o token do Agent. Ele nao sera salvo no GitHub."
npx wrangler secret put AGENT_TOKEN

Write-Host "Informe a URL do projeto Supabase (Project URL)."
npx wrangler secret put SUPABASE_URL

Write-Host "Informe a chave publica do Supabase (Publishable key ou anon key)."
npx wrangler secret put SUPABASE_ANON_KEY


Write-Host "Concluido. Copie a URL workers.dev exibida acima para agent/config.json."
