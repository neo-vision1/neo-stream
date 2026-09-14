#!/usr/bin/env sh
set -eu

if [ -e .env ]; then
  echo "O arquivo .env já existe. Nada foi alterado."
  exit 1
fi

umask 077
agent_token="$(openssl rand -hex 32)"
operator_key="$(openssl rand -hex 32)"

sed \
  -e "s/gere-um-token-forte/$agent_token/" \
  -e "s/gere-outra-chave-forte/$operator_key/" \
  .env.example > .env

echo "Arquivo .env criado. Guarde uma cópia segura das chaves."

