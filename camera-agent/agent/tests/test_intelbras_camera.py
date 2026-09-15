import sys
import time
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from intelbras_camera import IntelbrasCamera


class CameraTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        response = Mock(ok=True, text="OK")
        response.raise_for_status.return_value = None
        self.session.get.return_value = response
        self.config = {"ip": "192.168.1.100", "username": "u", "password": "p", "ptzCodes": {"up": "Up", "down": "Down", "left": "Left", "right": "Right"}}

    def test_move_and_stop_use_same_code(self):
        camera = IntelbrasCamera(self.config, movement_timeout=1, session=self.session)
        camera.move("left", 5)
        camera.stop()
        first = self.session.get.call_args_list[0].kwargs["params"]
        second = self.session.get.call_args_list[1].kwargs["params"]
        self.assertEqual((first["action"], first["code"]), ("start", "Left"))
        self.assertEqual((second["action"], second["code"]), ("stop", "Left"))

    def test_timeout_sends_stop(self):
        camera = IntelbrasCamera(self.config, movement_timeout=0.03, session=self.session)
        camera.move("up", 5)
        time.sleep(0.08)
        self.assertEqual(self.session.get.call_count, 2)
        self.assertEqual(self.session.get.call_args_list[-1].kwargs["params"]["action"], "stop")

    def test_rejects_invalid_direction(self):
        camera = IntelbrasCamera(self.config, session=self.session)
        with self.assertRaises(ValueError):
            camera.move("zoom", 5)

    def test_http_400_still_confirms_camera_is_reachable(self):
        self.session.get.return_value.status_code = 400
        camera = IntelbrasCamera(self.config, session=self.session)
        self.assertTrue(camera.check_online())


if __name__ == "__main__":
    unittest.main()
