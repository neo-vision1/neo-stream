import time
from agent import load_config
from intelbras_camera import IntelbrasCamera

config = load_config()
camera = IntelbrasCamera(config["camera"], movement_timeout=1)
print("Câmera online:", camera.check_online())
input("ENTER para mover LEFT por 0,3 segundo, ou CTRL+C para cancelar: ")
try:
    camera.move("left", 3)
    time.sleep(0.3)
finally:
    camera.stop()
print("Teste concluído e STOP enviado.")

