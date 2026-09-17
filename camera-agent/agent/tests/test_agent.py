import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agent import TalkController, camera_configs


class AgentConfigTests(unittest.TestCase):
    def test_accepts_multiple_cameras(self):
        cameras = [{"id": "CAM01"}, {"id": "CAM02"}]
        self.assertEqual(camera_configs({"cameras": cameras}), cameras)

    def test_keeps_legacy_single_camera_config(self):
        camera = {"id": "CAM01"}
        self.assertEqual(camera_configs({"camera": camera}), [camera])

    def test_applies_shared_camera_defaults(self):
        cameras = camera_configs({
            "cameraDefaults": {"username": "operator", "channel": 1},
            "cameras": [{"id": "CAM01", "ip": "192.168.15.16"}]
        })
        self.assertEqual(cameras[0]["username"], "operator")
        self.assertEqual(cameras[0]["channel"], 1)

    def test_rejects_duplicate_camera_ids(self):
        with self.assertRaisesRegex(ValueError, "não podem se repetir"):
            camera_configs({"cameras": [{"id": "CAM01"}, {"id": "CAM01"}]})

    def test_talk_controller_starts_empty(self):
        controller = TalkController({"CAM01": {"id": "CAM01"}})
        try:
            self.assertIsNone(controller.session)
            self.assertIsNone(controller.talk_id)
        finally:
            controller.executor.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    unittest.main()
