import unittest

from media_relay import ffmpeg_command


class MediaRelayTests(unittest.TestCase):
    def test_builds_stable_relay_and_escapes_credentials(self):
        camera = {
            "id": "CAM01", "ip": "192.168.1.17", "username": "op@x",
            "password": "a:b/c", "channel": 1, "relaySubtype": 1,
        }
        command = ffmpeg_command(camera, "secret-key")
        source = command[command.index("-i") + 1]
        self.assertEqual(source, "rtsp://op%40x:a%3Ab%2Fc@192.168.1.17:554/cam/realmonitor?channel=1&subtype=1")
        self.assertIn("+genpts+discardcorrupt", command)
        self.assertIn("libx264", command)
        self.assertIn("1200k", command)
        self.assertIn("1500k", command)
        self.assertIn("cfr", command)
        self.assertIn("aac", command)
        self.assertEqual(command[-1], "rtmps://global-live.mux.com:443/app/secret-key")

    def test_accepts_camera_specific_relay_limits(self):
        camera = {
            "id": "CAM02", "ip": "192.168.1.18", "username": "operator",
            "password": "local", "relayFps": 15,
            "relayVideoBitrateKbps": 800, "relayMaxBitrateKbps": 1000,
        }
        command = ffmpeg_command(camera, "secret-key")
        self.assertEqual(command[command.index("-r") + 1], "15")
        self.assertEqual(command[command.index("-b:v") + 1], "800k")
        self.assertEqual(command[command.index("-maxrate") + 1], "1000k")
        self.assertEqual(command[command.index("-g") + 1], "30")


if __name__ == "__main__":
    unittest.main()
