# Guia simplificado de implementação

## Objetivo

Controlar remotamente uma câmera Intelbras na rede Starlink usando um notebook Windows local, sem abrir a câmera para a internet.

## Arquitetura

```text
Painel + WSS no Cloudflare -> Agent Windows -> API local da câmera
```

O notebook inicia a conexão de saída; portanto, CGNAT não impede o controle. Oracle e Vercel não são usados. O vídeo segue diretamente por RTMP e não passa pelo Agent.

## Primeiro ciclo

1. Publicar a pasta `cloudflare/` com `deploy.ps1`.
2. Configurar o Agent no notebook.
3. Confirmar o PTZ local com `test_camera.py`.
4. Conectar o Agent ao endereço WSS do Cloudflare.
5. Testar UP, DOWN, LEFT, RIGHT e STOP pelo painel.
6. Gerar o executável com `build_exe.bat`.

## Critério de aprovação

- Operador em outra rede consegue mover a câmera.
- A câmera para quando o botão é solto.
- Se a conexão falhar, o Agent envia STOP automaticamente em até 2 segundos.
- Nenhum IP ou credencial da câmera fica no painel ou no backend.
- Não há VPN, Tailscale, IP público, DDNS ou port forwarding para a câmera.

## Depois do MVP

Somente após o teste completo: integrar vídeo, múltiplas câmeras, usuários, zoom, presets e início automático como serviço do Windows.
