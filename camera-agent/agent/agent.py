import asyncio
import json
import logging
import sys
from pathlib import Path

import websockets
from intelbras_camera import IntelbrasCamera
from media_relay import MediaRelaySupervisor


def app_dir():
    return Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent


def load_config():
    path = app_dir() / "config.json"
    if not path.exists():
        raise FileNotFoundError(f"Configuração não encontrada: {path}")
    # utf-8-sig also accepts config files saved by Windows PowerShell with BOM.
    with path.open(encoding="utf-8-sig") as file:
        return json.load(file)


def load_mux_keys():
    path = app_dir() / "mux_keys.json"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8-sig") as file:
        keys = json.load(file)
    if not isinstance(keys, dict):
        raise ValueError("mux_keys.json precisa conter um objeto")
    return {str(camera_id): str(key) for camera_id, key in keys.items() if key}


def camera_configs(config):
    """Return the camera list while keeping old one-camera configs compatible."""
    cameras = config.get("cameras")
    if cameras is None and config.get("camera"):
        cameras = [config["camera"]]
    if not isinstance(cameras, list) or not cameras:
        raise ValueError("Configure pelo menos uma câmera em 'cameras'")

    defaults = config.get("cameraDefaults", {})
    if not isinstance(defaults, dict):
        raise ValueError("'cameraDefaults' precisa ser um objeto")
    cameras = [{**defaults, **camera} if isinstance(camera, dict) else camera for camera in cameras]
    ids = [camera.get("id") for camera in cameras if isinstance(camera, dict)]
    if len(ids) != len(cameras) or any(not camera_id for camera_id in ids):
        raise ValueError("Toda câmera precisa de um ID")
    if len(ids) != len(set(ids)):
        raise ValueError("Os IDs das câmeras não podem se repetir")
    return cameras


def setup_logging():
    log_dir = app_dir() / "logs"
    log_dir.mkdir(exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=[logging.FileHandler(log_dir / "agent.log", encoding="utf-8"), logging.StreamHandler()])


async def heartbeat(ws, config, cameras):
    while True:
        statuses = await asyncio.gather(*(
            asyncio.to_thread(camera.check_online) for camera in cameras.values()
        ))
        await ws.send(json.dumps({
            "type": "heartbeat",
            "agentId": config["agentId"],
            "siteId": config["siteId"],
            "cameras": [
                {"cameraId": camera_id, "cameraOnline": online}
                for camera_id, online in zip(cameras, statuses)
            ]
        }))
        await asyncio.sleep(float(config.get("heartbeatSeconds", 10)))


async def run_session(config, cameras):
    async with websockets.connect(config["server"], ping_interval=20, ping_timeout=20, open_timeout=10) as ws:
        logging.info("WebSocket conectado")
        await ws.send(json.dumps({"type": "auth", "agentId": config["agentId"], "siteId": config["siteId"], "token": config["token"]}))
        response = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        if response.get("type") != "auth_ok":
            raise RuntimeError("Autenticação do Agent recusada")
        logging.info("Autenticação aceita")
        task = asyncio.create_task(heartbeat(ws, config, cameras))
        try:
            async for raw in ws:
                message = json.loads(raw)
                if message.get("type") != "ptz":
                    continue
                camera_id = message.get("cameraId")
                camera = cameras.get(camera_id)
                result = {"type": "command_result", "commandId": message.get("commandId"), "cameraId": camera_id, "command": message.get("command")}
                if camera is None:
                    result.update(success=False, error=f"Câmera {camera_id} não configurada no Agent")
                    logging.warning("Comando ignorado: câmera %s não configurada", camera_id)
                    await ws.send(json.dumps(result))
                    continue
                try:
                    if message.get("command") == "move":
                        await asyncio.to_thread(camera.move, message.get("direction", ""), message.get("speed", 5))
                        logging.info("%s MOVE %s", camera_id, message.get("direction", "").upper())
                    elif message.get("command") == "stop":
                        await asyncio.to_thread(camera.stop)
                        logging.info("%s STOP", camera_id)
                    else:
                        raise ValueError("Comando desconhecido")
                    result["success"] = True
                except Exception as exc:
                    logging.error("Erro ao executar comando: %s", exc)
                    result.update(success=False, error=str(exc)[:200])
                await ws.send(json.dumps(result))
        finally:
            task.cancel()
            await asyncio.gather(*(
                asyncio.to_thread(camera.stop, True) for camera in cameras.values()
            ))


async def main():
    setup_logging()
    config = load_config()
    configs = camera_configs(config)
    cameras = {
        camera_config["id"]: IntelbrasCamera(camera_config, config.get("movementTimeoutSeconds", 2))
        for camera_config in configs
    }
    relay = MediaRelaySupervisor(configs, load_mux_keys(), app_dir() / "logs", config.get("ffmpegPath", "ffmpeg"))
    await relay.start()
    delays = [2, 5, 10, 30]
    attempt = 0
    logging.info("Agent iniciado com %s câmera(s): %s", len(cameras), ", ".join(cameras))
    try:
        while True:
            try:
                await run_session(config, cameras)
                attempt = 0
            except Exception as exc:
                delay = delays[min(attempt, len(delays) - 1)]
                attempt += 1
                logging.warning("Conexão indisponível: %s. Nova tentativa em %ss", exc, delay)
                await asyncio.sleep(delay)
    finally:
        await relay.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
