import asyncio
import json
import logging
import sys
from pathlib import Path

import websockets
from intelbras_camera import IntelbrasCamera


def app_dir():
    return Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent


def load_config():
    path = app_dir() / "config.json"
    if not path.exists():
        raise FileNotFoundError(f"Configuração não encontrada: {path}")
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def setup_logging():
    log_dir = app_dir() / "logs"
    log_dir.mkdir(exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=[logging.FileHandler(log_dir / "agent.log", encoding="utf-8"), logging.StreamHandler()])


async def heartbeat(ws, config, camera):
    while True:
        await ws.send(json.dumps({"type": "heartbeat", "agentId": config["agentId"], "siteId": config["siteId"], "cameraId": config["camera"]["id"], "cameraOnline": await asyncio.to_thread(camera.check_online)}))
        await asyncio.sleep(float(config.get("heartbeatSeconds", 10)))


async def run_session(config, camera):
    async with websockets.connect(config["server"], ping_interval=20, ping_timeout=20, open_timeout=10) as ws:
        logging.info("WebSocket conectado")
        await ws.send(json.dumps({"type": "auth", "agentId": config["agentId"], "siteId": config["siteId"], "token": config["token"]}))
        response = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        if response.get("type") != "auth_ok":
            raise RuntimeError("Autenticação do Agent recusada")
        logging.info("Autenticação aceita")
        task = asyncio.create_task(heartbeat(ws, config, camera))
        try:
            async for raw in ws:
                message = json.loads(raw)
                if message.get("type") != "ptz" or message.get("cameraId") != config["camera"]["id"]:
                    continue
                result = {"type": "command_result", "commandId": message.get("commandId"), "cameraId": message.get("cameraId"), "command": message.get("command")}
                try:
                    if message.get("command") == "move":
                        await asyncio.to_thread(camera.move, message.get("direction", ""), message.get("speed", 5))
                        logging.info("MOVE %s", message.get("direction", "").upper())
                    elif message.get("command") == "stop":
                        await asyncio.to_thread(camera.stop)
                        logging.info("STOP")
                    else:
                        raise ValueError("Comando desconhecido")
                    result["success"] = True
                except Exception as exc:
                    logging.error("Erro ao executar comando: %s", exc)
                    result.update(success=False, error=str(exc)[:200])
                await ws.send(json.dumps(result))
        finally:
            task.cancel()
            await asyncio.to_thread(camera.stop, True)


async def main():
    setup_logging()
    config = load_config()
    camera = IntelbrasCamera(config["camera"], config.get("movementTimeoutSeconds", 2))
    delays = [2, 5, 10, 30]
    attempt = 0
    logging.info("Agent iniciado")
    while True:
        try:
            await run_session(config, camera)
            attempt = 0
        except Exception as exc:
            delay = delays[min(attempt, len(delays) - 1)]
            attempt += 1
            logging.warning("Conexão indisponível: %s. Nova tentativa em %ss", exc, delay)
            await asyncio.sleep(delay)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

