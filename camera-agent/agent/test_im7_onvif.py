"""Teste de campo curto e confirmado para a iM7+ Zoom Full Color."""

import asyncio

from agent import camera_configs, load_config
from onvif_camera import OnvifCamera


async def main():
    config = load_config()
    choices = {camera["id"]: camera for camera in camera_configs(config) if camera.get("ptzProtocol", "cgi").lower() == "onvif"}
    if not choices:
        raise SystemExit("Nenhuma câmera com ptzProtocol=onvif no config.json")
    camera_id = input(f"ID da iM7+ ({', '.join(choices)}): ").strip().upper()
    if camera_id not in choices:
        raise SystemExit("ID ONVIF não encontrado")
    camera = OnvifCamera(choices[camera_id], .3)
    try:
        if not await camera.check_online():
            raise SystemExit("Câmera não respondeu via ONVIF; confira IP, porta, admin e chave de acesso")
        print(f"{camera_id} online; zoom contínuo: {'sim' if camera.supports_zoom else 'não'}")
        input("ENTER move para a esquerda por 0,3 s; Ctrl+C cancela: ")
        await camera.move("left", 2)
        await asyncio.sleep(.35)
        if camera.supports_zoom:
            input("ENTER aproxima o zoom por 0,3 s; Ctrl+C cancela: ")
            await camera.zoom("in", 2)
            await asyncio.sleep(.35)
        print("Teste concluído e STOP enviado.")
    finally:
        await camera.close()


if __name__ == "__main__":
    asyncio.run(main())
