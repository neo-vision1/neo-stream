import asyncio
import base64
import concurrent.futures
import json
import logging
import sys
from pathlib import Path

import websockets
from intelbras_camera import IntelbrasCamera
from intelbras_talk import DahuaTalkSession
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


class TalkController:
    def __init__(self, camera_settings):
        self.camera_settings = camera_settings
        self.session = None
        self.camera_id = None
        self.talk_id = None
        self.last_audio = 0
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="camera-talk")

    async def _call(self, function, *args):
        return await asyncio.get_running_loop().run_in_executor(self.executor, function, *args)

    async def start(self, camera_id, talk_id):
        await self.stop()
        camera = self.camera_settings.get(camera_id)
        if not camera:
            raise ValueError(f"Câmera {camera_id} não configurada no Agent")
        session = DahuaTalkSession(camera)
        try:
            await self._call(session.start, False)
            await self._call(session.enable_pcm_encoder)
        except Exception:
            await self._call(session.stop)
            raise
        self.session = session
        self.camera_id = camera_id
        self.talk_id = talk_id
        self.last_audio = asyncio.get_running_loop().time()

    async def audio(self, camera_id, talk_id, pcm):
        if not self.session or camera_id != self.camera_id or talk_id != self.talk_id:
            return False
        await self._call(self.session.send_pcm, pcm)
        self.last_audio = asyncio.get_running_loop().time()
        return True

    async def stop(self, talk_id=None):
        if talk_id and self.talk_id and talk_id != self.talk_id:
            return False
        session, self.session = self.session, None
        self.camera_id = None
        self.talk_id = None
        self.last_audio = 0
        if session:
            await self._call(session.stop)
        return True

    async def watchdog(self):
        while True:
            await asyncio.sleep(1)
            if self.session and asyncio.get_running_loop().time() - self.last_audio > 3:
                logging.warning("Conversação encerrada por timeout de segurança")
                await self.stop()

    async def close(self):
        await self.stop()
        self.executor.shutdown(wait=False, cancel_futures=True)


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


async def run_session(config, cameras, talk):
    async with websockets.connect(config["server"], ping_interval=20, ping_timeout=20, open_timeout=10) as ws:
        logging.info("WebSocket conectado")
        await ws.send(json.dumps({"type": "auth", "agentId": config["agentId"], "siteId": config["siteId"], "token": config["token"]}))
        response = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        if response.get("type") != "auth_ok":
            raise RuntimeError("Autenticação do Agent recusada")
        logging.info("Autenticação aceita")
        task = asyncio.create_task(heartbeat(ws, config, cameras))
        talk_watchdog = asyncio.create_task(talk.watchdog())
        try:
            async for raw in ws:
                message = json.loads(raw)
                if message.get("type") == "talk_start":
                    camera_id, talk_id = message.get("cameraId"), message.get("talkId")
                    result = {"type": "talk_result", "cameraId": camera_id, "talkId": talk_id, "action": "started"}
                    try:
                        await talk.start(camera_id, talk_id)
                        result["ok"] = True
                        logging.info("%s TALK START", camera_id)
                    except Exception as exc:
                        logging.error("Falha ao iniciar conversação: %s", exc)
                        result.update(ok=False, error=str(exc)[:200])
                    await ws.send(json.dumps(result))
                    continue
                if message.get("type") == "talk_audio":
                    try:
                        pcm = base64.b64decode(message.get("audio", ""), validate=True)
                        if not pcm or len(pcm) > 16_000:
                            raise ValueError("Bloco PCM inválido")
                        await talk.audio(message.get("cameraId"), message.get("talkId"), pcm)
                    except Exception as exc:
                        logging.warning("Bloco de áudio rejeitado: %s", exc)
                    continue
                if message.get("type") == "talk_stop":
                    talk_id = message.get("talkId")
                    camera_id = message.get("cameraId")
                    await talk.stop(talk_id)
                    logging.info("%s TALK STOP", camera_id)
                    await ws.send(json.dumps({"type": "talk_result", "cameraId": camera_id, "talkId": talk_id, "action": "stopped", "ok": True}))
                    continue
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
            talk_watchdog.cancel()
            await talk.stop()
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
    settings = {camera["id"]: camera for camera in configs}
    talk = TalkController(settings)
    relay = MediaRelaySupervisor(configs, load_mux_keys(), app_dir() / "logs", config.get("ffmpegPath", "ffmpeg"))
    await relay.start()
    delays = [2, 5, 10, 30]
    attempt = 0
    logging.info("Agent iniciado com %s câmera(s): %s", len(cameras), ", ".join(cameras))
    try:
        while True:
            try:
                await run_session(config, cameras, talk)
                attempt = 0
            except Exception as exc:
                delay = delays[min(attempt, len(delays) - 1)]
                attempt += 1
                logging.warning("Conexão indisponível: %s. Nova tentativa em %ss", exc, delay)
                await asyncio.sleep(delay)
    finally:
        await talk.close()
        await relay.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
