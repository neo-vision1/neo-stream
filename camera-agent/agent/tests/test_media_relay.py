import unittest

from media_relay import ffmpeg_command


class MediaRelayTests(unittest.TestCase):
    def test_builds_lightweight_relay_and_escapes_credentials(self):
        camera = {
            "id": "CAM01", "ip": "192.168.1.17", "username": "op@x",
            "password": "a:b/c", "channel": 1, "relaySubtype": 1,
        }
        command = ffmpeg_command(camera, "secret-key")
        source = command[command.index("-i") + 1]
        self.assertEqual(source, "rtsp://op%40x:a%3Ab%2Fc@192.168.1.17:554/cam/realmonitor?channel=1&subtype=1")
        self.assertIn("copy", command)
        self.assertIn("aac", command)
        self.assertEqual(command[-1], "rtmp://global-live.mux.com:5222/app/secret-key")


if __name__ == "__main__":
    unittest.main()
