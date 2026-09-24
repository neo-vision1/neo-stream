import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from onvif_camera import OnvifCamera


class OnvifCameraTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.ptz = SimpleNamespace(ContinuousMove=AsyncMock(), Stop=AsyncMock(), GetNodes=AsyncMock(return_value=[
            SimpleNamespace(SupportedPTZSpaces=SimpleNamespace(ContinuousZoomVelocitySpace=[object()]))
        ]))
        self.media = SimpleNamespace(GetProfiles=AsyncMock(return_value=[SimpleNamespace(token="profile-1", PTZConfiguration=object())]))
        self.device = SimpleNamespace(GetDeviceInformation=AsyncMock(return_value={"Model": "iM7+"}))
        instance = SimpleNamespace(
            update_xaddrs=AsyncMock(), create_media_service=lambda: self.media,
            create_ptz_service=lambda: self.ptz, devicemgmt=self.device, close=AsyncMock()
        )
        self.factory = patch("onvif_camera.ONVIFCamera", return_value=instance)
        self.factory.start()
        self.camera = OnvifCamera({"id": "CAM11", "ip": "192.168.1.20", "username": "admin", "password": "secret"}, 10)

    async def asyncTearDown(self):
        if self.camera._stop_task:
            self.camera._stop_task.cancel()
            await asyncio.gather(self.camera._stop_task, return_exceptions=True)
        self.factory.stop()

    async def test_detects_zoom_and_sends_continuous_zoom(self):
        self.assertTrue(await self.camera.check_online())
        self.assertTrue(self.camera.supports_zoom)
        await self.camera.zoom("in", 4)
        request = self.ptz.ContinuousMove.await_args.args[0]
        self.assertEqual(request["ProfileToken"], "profile-1")
        self.assertEqual(request["Velocity"]["Zoom"]["x"], .5)

    async def test_stop_stops_pan_tilt_and_zoom(self):
        await self.camera.stop()
        self.ptz.Stop.assert_awaited_with({"ProfileToken": "profile-1", "PanTilt": True, "Zoom": True})


if __name__ == "__main__":
    unittest.main()
