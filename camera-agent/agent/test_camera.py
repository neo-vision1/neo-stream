import time
from agent import camera_configs, load_config
from intelbras_camera import IntelbrasCamera

config = load_config()
configs = camera_configs(config)
camera_id = input(f"ID da câmera ({', '.join(camera['id'] for camera in configs)}): ").strip() or configs[0]["id"]
selected = next((camera for camera in configs if camera["id"] == camera_id), None)
if selected is None:
    raise ValueError(f"Câmera {camera_id} não configurada")
camera = IntelbrasCamera(selected, movement_timeout=1)
print(f"{camera_id} online:", camera.check_online())
input("ENTER para mover LEFT por 0,3 segundo, ou CTRL+C para cancelar: ")
try:
    camera.move("left", 3)
    time.sleep(0.3)
finally:
    camera.stop()
print("Teste concluído e STOP enviado.")
