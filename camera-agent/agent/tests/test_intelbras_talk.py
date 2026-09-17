import unittest
from unittest.mock import patch

from intelbras_talk import AudioFormat, DahuaTalkSession, TalkError


class DahuaTalkSessionTests(unittest.TestCase):
    def test_rejects_non_windows_before_loading_dll(self):
        talk = DahuaTalkSession({"ip": "192.0.2.1", "username": "u", "password": "p"})
        with patch("intelbras_talk.os.name", "posix"):
            with self.assertRaisesRegex(TalkError, "somente no Windows"):
                talk._load()

    def test_stop_before_start_is_safe(self):
        DahuaTalkSession({"ip": "192.0.2.1", "username": "u", "password": "p"}).stop()

    def test_pcm_format_layout_matches_netsdk(self):
        self.assertEqual(AudioFormat.byFormatTag.offset, 0)
        self.assertEqual(AudioFormat.nChannels.offset, 2)
        self.assertEqual(AudioFormat.wBitsPerSample.offset, 4)
        self.assertEqual(AudioFormat.nSamplesPerSec.offset, 8)
        self.assertEqual(__import__("ctypes").sizeof(AudioFormat), 12)


if __name__ == "__main__":
    unittest.main()
