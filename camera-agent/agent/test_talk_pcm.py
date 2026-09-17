import argparse
import math
import struct
import time

from agent import camera_configs, load_config
from intelbras_talk import DahuaTalkSession, TalkError


def tone_pcm(duration=1.0, frequency=440.0, volume=0.08, sample_rate=8000):
    samples = int(duration * sample_rate)
    return b"".join(
        struct.pack("<h", int(32767 * volume * math.sin(2 * math.pi * frequency * i / sample_rate)))
        for i in range(samples)
    )


def main():
    parser = argparse.ArgumentParser(description="Teste do caminho PCM usado pelo navegador")
    parser.add_argument("--camera", default="CAM01")
    args = parser.parse_args()
    camera = next(
        (item for item in camera_configs(load_config()) if item["id"] == args.camera),
        None,
    )
    if not camera:
        raise SystemExit(f"Câmera {args.camera} não encontrada no config.json")

    print(f"Enviando um tom baixo de 1 segundo para {args.camera}...")
    try:
        session = DahuaTalkSession(camera)
        try:
            session.start(capture_microphone=False)
            session.enable_pcm_encoder()
            pcm = tone_pcm()
            for offset in range(0, len(pcm), 1600):
                session.send_pcm(pcm[offset:offset + 1600])
                time.sleep(0.1)
            time.sleep(0.3)
        finally:
            session.stop()
        print("Teste PCM encerrado com segurança.")
    except TalkError as exc:
        raise SystemExit(f"ERRO: {exc}") from exc


if __name__ == "__main__":
    main()
