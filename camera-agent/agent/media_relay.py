import asyncio
import logging
from pathlib import Path
from urllib.parse import quote


def ffmpeg_command(camera, stream_key, ffmpeg="ffmpeg", ingest_url="rtmp://global-live.mux.com:5222/app"):
    username = quote(str(camera["username"]), safe="")
    password = quote(str(camera["password"]), safe="")
    ip = camera["ip"]
    channel = int(camera.get("channel", 1))
    subtype = int(camera.get("relaySubtype", 1))
    source = f"rtsp://{username}:{password}@{ip}:554/cam/realmonitor?channel={channel}&subtype={subtype}"
    destination = f"{ingest_url.rstrip('/')}/{stream_key}"
    return [
        ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "warning",
        "-rtsp_transport", "tcp", "-rw_timeout", "10000000", "-i", source,
        "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "64k", "-ar", "48000", "-ac", "1",
        "-f", "flv", destination,
    ]


class MediaRelaySupervisor:
    def __init__(self, cameras, stream_keys, log_dir, ffmpeg="ffmpeg"):
        self.cameras = cameras
        self.stream_keys = stream_keys
        self.log_dir = Path(log_dir)
        self.ffmpeg = ffmpeg
        self.tasks = []
        self.processes = {}
        self.stopping = False

    async def start(self):
        self.log_dir.mkdir(exist_ok=True)
        for camera in self.cameras:
            camera_id = camera["id"]
            stream_key = self.stream_keys.get(camera_id)
            if stream_key:
                self.tasks.append(asyncio.create_task(self._run(camera, stream_key)))
        if self.tasks:
            logging.info("Relay Mux habilitado para: %s", ", ".join(self.stream_keys.keys()))
        else:
            logging.info("Relay Mux não configurado; RTMP direto permanece independente")

    async def _run(self, camera, stream_key):
        camera_id = camera["id"]
        log_path = self.log_dir / f"relay-{camera_id}.log"
        while not self.stopping:
            try:
                with log_path.open("ab") as relay_log:
                    process = await asyncio.create_subprocess_exec(
                        *ffmpeg_command(camera, stream_key, self.ffmpeg),
                        stdin=asyncio.subprocess.DEVNULL,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=relay_log,
                    )
                    self.processes[camera_id] = process
                    logging.info("%s relay Mux iniciado", camera_id)
                    return_code = await process.wait()
                self.processes.pop(camera_id, None)
                if not self.stopping:
                    logging.warning("%s relay Mux encerrou (código %s); reiniciando em 5s", camera_id, return_code)
                    await asyncio.sleep(5)
            except FileNotFoundError:
                logging.error("FFmpeg não encontrado; relay %s tentará novamente em 30s", camera_id)
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logging.error("Falha no relay %s: %s; nova tentativa em 10s", camera_id, exc)
                await asyncio.sleep(10)

    async def stop(self):
        self.stopping = True
        for process in self.processes.values():
            if process.returncode is None:
                process.terminate()
        if self.processes:
            await asyncio.gather(*(process.wait() for process in self.processes.values()), return_exceptions=True)
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
