# Regras do projeto

- O Agent no notebook sempre inicia a conexão com o backend.
- Não usar IP público, port forwarding, DDNS, VPN ou Tailscale.
- A câmera só é acessada pelo Agent dentro da LAN.
- IP e credenciais da câmera nunca chegam ao frontend ou ao backend.
- O primeiro MVP controla uma câmera com UP, DOWN, LEFT, RIGHT e STOP.
- Todo movimento deve ter STOP explícito e timeout local de segurança.
- Nunca registrar senhas, tokens ou chaves completas nos logs.
- Toda alteração funcional deve incluir teste e documentação.

