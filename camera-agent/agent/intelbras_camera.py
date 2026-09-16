import threading
from urllib.parse import urljoin

import requests
from requests.auth import HTTPDigestAuth


class IntelbrasCamera:
    DIRECTIONS = {"up", "down", "left", "right"}

    def __init__(self, config, movement_timeout=2.0, session=None):
        self.config = config
        self.timeout = float(movement_timeout)
        self.base_url = f"{config.get('scheme', 'http')}://{config['ip']}"
        self.session = session or requests.Session()
        self.session.auth = HTTPDigestAuth(config["username"], config["password"])
        self.verify_tls = bool(config.get("verifyTls", False))
        self.channel = int(config.get("channel", 1))
        self.codes = config.get("ptzCodes", {"up": "Up", "down": "Down", "left": "Left", "right": "Right"})
        self._timer = None
        self._active_code = None
        self._lock = threading.RLock()

    def _request(self, action, code, speed=5):
        params = {"action": action, "channel": self.channel, "code": code, "arg1": 0, "arg2": int(speed), "arg3": 0}
        response = self.session.get(urljoin(self.base_url, "/cgi-bin/ptz.cgi"), params=params, timeout=4, verify=self.verify_tls)
        response.raise_for_status()
        if response.text.strip() and not response.text.strip().upper().startswith("OK"):
            raise RuntimeError(f"Resposta inesperada da câmera: {response.text[:120]}")
        return True

    def check_online(self):
        try:
            response = self.session.get(urljoin(self.base_url, "/cgi-bin/magicBox.cgi"), params={"action": "getSystemInfo"}, timeout=3, verify=self.verify_tls)
            # Alguns modelos Intelbras respondem HTTP 400/"Error" para
            # getSystemInfo, mesmo estando acessíveis. Qualquer resposta HTTP
            # abaixo de 500 confirma que o dispositivo respondeu na rede.
            return response.status_code < 500
        except requests.RequestException:
            return False

    def move(self, direction, speed=5):
        direction = direction.lower()
        if direction not in self.DIRECTIONS or direction not in self.codes:
            raise ValueError("Direção PTZ inválida")
        speed = max(1, min(8, int(speed)))
        with self._lock:
            self.stop(ignore_errors=True)
            code = self.codes[direction]
            self._request("start", code, speed)
            self._active_code = code
            self._timer = threading.Timer(self.timeout, self.stop)
            self._timer.daemon = True
            self._timer.start()
        return True

    def stop(self, ignore_errors=False):
        with self._lock:
            if self._timer:
                self._timer.cancel()
                self._timer = None
            code = self._active_code
            self._active_code = None
            if not code:
                return True
            try:
                return self._request("stop", code, 0)
            except Exception:
                if not ignore_errors:
                    raise
                return False
