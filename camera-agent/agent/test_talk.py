import argparse
import time

from agent import camera_configs, load_config
from intelbras_talk import DahuaTalkSession, TalkError


def main():
    parser = argparse.ArgumentParser(description="Teste local do microfone na câmera Intelbras")
    parser.add_argument("--camera", default="CAM01")
    parser.add_argument("--seconds", type=int, default=10)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 30:
        raise SystemExit("Use uma duração entre 1 e 30 segundos")

    cameras = camera_configs(load_config())
    camera = next((item for item in cameras if item["id"] == args.camera), None)
    if not camera:
        raise SystemExit(f"Câmera {args.camera} não encontrada no config.json")

    print(f"Iniciando conversação em {args.camera} por {args.seconds} segundos...")
    print("Fale perto do microfone. Pressione Ctrl+C para parar antes.")
    try:
        with DahuaTalkSession(camera):
            for remaining in range(args.seconds, 0, -1):
                print(f"Transmitindo: {remaining}s ", end="\r", flush=True)
                time.sleep(1)
        print("\nTeste encerrado com segurança.")
    except KeyboardInterrupt:
        print("\nTeste interrompido; conversação encerrada.")
    except TalkError as exc:
        raise SystemExit(f"ERRO: {exc}") from exc


if __name__ == "__main__":
    main()
