import asyncio
import inspect
import logging

try:
    from onvif import ONVIFCamera
except ImportError:  # Allows config/tests to load before optional dependencies are installed.
    ONVIFCamera = None


class OnvifCamera:
    """Async ONVIF PTZ controller used only inside the camera LAN."""

    async_native = True

    def __init__(self, config, movement_timeout=2):
        self.config = config
        self.movement_timeout = float(movement_timeout)
        self.camera = None
        self.ptz = None
        self.device = None
        self.profile_token = None
        self.supports_zoom = False
        self._stop_task = None
        self._lock = asyncio.Lock()

    async def _connect(self):
        if self.ptz and self.profile_token:
            return
        if ONVIFCamera is None:
            raise RuntimeError("Instale as dependências do Agent para habilitar ONVIF")
        camera = ONVIFCamera(
            self.config["ip"], int(self.config.get("onvifPort", 80)),
            self.config.get("username", "admin"), self.config["password"],
            adjust_time=bool(self.config.get("onvifAdjustTime", False)), no_cache=True,
        )
        try:
            await camera.update_xaddrs()
            media = await camera.create_media_service()
            ptz = await camera.create_ptz_service()
            device = await camera.create_devicemgmt_service()
            profiles = await media.GetProfiles()
            usable = [profile for profile in profiles if getattr(profile, "PTZConfiguration", None)] or list(profiles)
            if not usable:
                raise RuntimeError("A câmera ONVIF não informou perfis de mídia")
            index = min(int(self.config.get("onvifProfileIndex", 0)), len(usable) - 1)
            profile_token = usable[index].token
            nodes = await ptz.GetNodes()
            spaces = getattr(nodes[0], "SupportedPTZSpaces", None) if nodes else None
        except Exception:
            await camera.close()
            raise
        self.camera, self.ptz, self.device = camera, ptz, device
        self.profile_token = profile_token
        self.supports_zoom = bool(getattr(spaces, "ContinuousZoomVelocitySpace", None))
        if self.config.get("supportsZoom") is False:
            self.supports_zoom = False

    async def check_online(self):
        try:
            await self._connect()
            await self.device.GetDeviceInformation()
            return True
        except Exception as exc:
            logging.warning("Câmera ONVIF %s indisponível: %s", self.config.get("id"), exc)
            await self._discard_camera()
            self.supports_zoom = False
            return False

    async def _discard_camera(self):
        camera = self.camera
        self.camera = self.ptz = self.device = self.profile_token = None
        if camera:
            result = camera.close()
            if inspect.isawaitable(result):
                await result

    def _schedule_stop(self):
        if self._stop_task:
            self._stop_task.cancel()
        self._stop_task = asyncio.create_task(self._stop_after_timeout())

    async def _stop_after_timeout(self):
        try:
            await asyncio.sleep(self.movement_timeout)
            await self.stop(from_timer=True)
        except asyncio.CancelledError:
            pass

    async def move(self, direction, speed=4):
        vectors = {"up": (0, 1), "down": (0, -1), "left": (-1, 0), "right": (1, 0)}
        if direction not in vectors:
            raise ValueError("Direção PTZ inválida")
        await self._connect()
        scale = max(1, min(8, int(speed))) / 8
        x, y = vectors[direction]
        async with self._lock:
            await self.ptz.ContinuousMove({"ProfileToken": self.profile_token, "Velocity": {"PanTilt": {"x": x * scale, "y": y * scale}}})
            self._schedule_stop()

    async def zoom(self, direction, speed=4):
        if direction not in {"in", "out"}:
            raise ValueError("Direção de zoom inválida")
        await self._connect()
        if not self.supports_zoom:
            raise RuntimeError("A câmera não informou zoom contínuo via ONVIF")
        scale = max(1, min(8, int(speed))) / 8
        async with self._lock:
            await self.ptz.ContinuousMove({"ProfileToken": self.profile_token, "Velocity": {"Zoom": {"x": scale if direction == "in" else -scale}}})
            self._schedule_stop()

    async def stop(self, from_timer=False):
        if self._stop_task and not from_timer:
            self._stop_task.cancel()
        self._stop_task = None
        await self._connect()
        async with self._lock:
            await self.ptz.Stop({"ProfileToken": self.profile_token, "PanTilt": True, "Zoom": True})

    async def close(self):
        try:
            if self.ptz and self.profile_token:
                await self.stop()
        finally:
            if self.camera:
                await self._discard_camera()
