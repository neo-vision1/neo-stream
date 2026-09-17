"""Local voice talk through the Intelbras/Dahua Windows NetSDK."""

import ctypes
import os
from pathlib import Path


class TalkError(RuntimeError):
    pass


class AudioFormat(ctypes.Structure):
    _fields_ = [
        ("byFormatTag", ctypes.c_ubyte),
        ("nChannels", ctypes.c_ushort),
        ("wBitsPerSample", ctypes.c_ushort),
        ("nSamplesPerSec", ctypes.c_uint),
    ]


class DahuaTalkSession:
    DEFAULT_SDK_DIR = Path(r"C:\Program Files\Intelbras\SIMNext\SIM Next")

    def __init__(self, camera, sdk_dir=None):
        self.camera = camera
        self.sdk_dir = Path(sdk_dir or self.DEFAULT_SDK_DIR)
        self.sdk = None
        self.login_handle = 0
        self.talk_handle = 0
        self.recording = False
        self.initialized = False
        self.encoder_initialized = False
        self._disconnect_callback = None
        self._audio_callback = None

    def _last_error(self):
        return int(self.sdk.CLIENT_GetLastError()) if self.sdk else 0

    def _load(self):
        dll_path = self.sdk_dir / "dhnetsdk.dll"
        if os.name != "nt":
            raise TalkError("A conversação NetSDK funciona somente no Windows")
        if not dll_path.exists():
            raise TalkError(f"dhnetsdk.dll não encontrada em {self.sdk_dir}")

        os.add_dll_directory(str(self.sdk_dir))
        self.sdk = ctypes.WinDLL(str(dll_path))
        self.sdk.CLIENT_Init.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.sdk.CLIENT_Init.restype = ctypes.c_int
        self.sdk.CLIENT_LoginEx2.argtypes = [
            ctypes.c_char_p, ctypes.c_ushort, ctypes.c_char_p, ctypes.c_char_p,
            ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_int),
        ]
        self.sdk.CLIENT_LoginEx2.restype = ctypes.c_longlong
        self.sdk.CLIENT_StartTalkEx.argtypes = [
            ctypes.c_longlong, ctypes.c_void_p, ctypes.c_void_p,
        ]
        self.sdk.CLIENT_StartTalkEx.restype = ctypes.c_longlong
        self.sdk.CLIENT_TalkSendData.argtypes = [
            ctypes.c_longlong, ctypes.c_void_p, ctypes.c_uint,
        ]
        self.sdk.CLIENT_TalkSendData.restype = ctypes.c_long
        self.sdk.CLIENT_RecordStart.argtypes = []
        self.sdk.CLIENT_RecordStart.restype = ctypes.c_int
        self.sdk.CLIENT_RecordStop.argtypes = []
        self.sdk.CLIENT_RecordStop.restype = ctypes.c_int
        self.sdk.CLIENT_InitAudioEncode.argtypes = [AudioFormat]
        self.sdk.CLIENT_InitAudioEncode.restype = ctypes.c_int
        self.sdk.CLIENT_AudioEncode.argtypes = [
            ctypes.c_longlong, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint),
            ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint),
        ]
        self.sdk.CLIENT_AudioEncode.restype = ctypes.c_int
        self.sdk.CLIENT_ReleaseAudioEncode.argtypes = []
        self.sdk.CLIENT_ReleaseAudioEncode.restype = ctypes.c_int
        self.sdk.CLIENT_StopTalkEx.argtypes = [ctypes.c_longlong]
        self.sdk.CLIENT_StopTalkEx.restype = ctypes.c_int
        self.sdk.CLIENT_Logout.argtypes = [ctypes.c_longlong]
        self.sdk.CLIENT_Logout.restype = ctypes.c_int
        self.sdk.CLIENT_Cleanup.argtypes = []

    def start(self, capture_microphone=True):
        self._load()
        disconnect_type = ctypes.WINFUNCTYPE(
            None, ctypes.c_longlong, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p
        )
        self._disconnect_callback = disconnect_type(lambda *_: None)
        if not self.sdk.CLIENT_Init(self._disconnect_callback, None):
            raise TalkError(f"Falha ao iniciar NetSDK (erro {self._last_error()})")
        self.initialized = True

        device_info = ctypes.create_string_buffer(1024)
        login_error = ctypes.c_int(0)
        self.login_handle = int(self.sdk.CLIENT_LoginEx2(
            str(self.camera["ip"]).encode(),
            int(self.camera.get("tcpPort", 37777)),
            str(self.camera["username"]).encode(),
            str(self.camera["password"]).encode(),
            0, None, device_info, ctypes.byref(login_error),
        ))
        if not self.login_handle:
            raise TalkError(
                f"Login NetSDK recusado (código {login_error.value}, erro {self._last_error()})"
            )

        audio_type = ctypes.WINFUNCTYPE(
            None, ctypes.c_longlong, ctypes.c_void_p, ctypes.c_uint,
            ctypes.c_ubyte, ctypes.c_void_p,
        )

        def forward_microphone(talk_handle, buffer, length, audio_flag, _user):
            if audio_flag == 0 and buffer and length:
                self.sdk.CLIENT_TalkSendData(talk_handle, buffer, length)

        self._audio_callback = audio_type(forward_microphone)
        self.talk_handle = int(self.sdk.CLIENT_StartTalkEx(
            self.login_handle, self._audio_callback, None
        ))
        if not self.talk_handle:
            raise TalkError(f"A câmera recusou a conversação (erro {self._last_error()})")
        if capture_microphone:
            if not self.sdk.CLIENT_RecordStart():
                raise TalkError(f"Não foi possível abrir o microfone (erro {self._last_error()})")
            self.recording = True

    def enable_pcm_encoder(self):
        audio_format = AudioFormat(0, 1, 16, 8000)
        if self.sdk.CLIENT_InitAudioEncode(audio_format) != 0:
            raise TalkError(f"Falha ao iniciar codificador PCM (erro {self._last_error()})")
        self.encoder_initialized = True

    def send_pcm(self, pcm):
        if not self.talk_handle or not self.encoder_initialized:
            raise TalkError("Conversação PCM não iniciada")
        if not pcm or len(pcm) > 16_000:
            raise TalkError("Bloco PCM vazio ou grande demais")
        source = ctypes.create_string_buffer(pcm)
        source_length = ctypes.c_uint(len(pcm))
        output = ctypes.create_string_buffer(len(pcm) + 4096)
        output_length = ctypes.c_uint(len(output))
        result = self.sdk.CLIENT_AudioEncode(
            self.login_handle,
            source,
            ctypes.byref(source_length),
            output,
            ctypes.byref(output_length),
        )
        if result != 0:
            raise TalkError(f"Falha ao codificar PCM (erro {self._last_error()})")
        if output_length.value:
            sent = self.sdk.CLIENT_TalkSendData(
                self.talk_handle, output, output_length.value
            )
            if sent <= 0:
                raise TalkError(f"Falha ao enviar áudio (erro {self._last_error()})")
        return output_length.value

    def stop(self):
        if not self.sdk:
            return
        if self.recording:
            self.sdk.CLIENT_RecordStop()
            self.recording = False
        if self.encoder_initialized:
            self.sdk.CLIENT_ReleaseAudioEncode()
            self.encoder_initialized = False
        if self.talk_handle:
            self.sdk.CLIENT_StopTalkEx(self.talk_handle)
            self.talk_handle = 0
        if self.login_handle:
            self.sdk.CLIENT_Logout(self.login_handle)
            self.login_handle = 0
        if self.initialized:
            self.sdk.CLIENT_Cleanup()
            self.initialized = False

    def __enter__(self):
        try:
            self.start()
            return self
        except Exception:
            self.stop()
            raise

    def __exit__(self, *_exc):
        self.stop()
