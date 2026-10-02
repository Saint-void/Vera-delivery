"""Background WebSocket telemetry client streaming from Vera to Vella."""

import json
import threading

import websockets.sync.client

from vera.config import get_vella_ws_url


class VellaTelemetryClient:
    """Streams Vera telemetry to Vella over WebSocket at ~5 Hz with automatic reconnect."""

    def __init__(self, controller, ws_url=None, rate_hz=5.0):
        self.controller = controller
        self._custom_ws_url = ws_url
        self.interval_s = 1.0 / rate_hz
        self._stop = threading.Event()
        self._thread = None

    @property
    def ws_url(self):
        return self._custom_ws_url or get_vella_ws_url()

    @property
    def enabled(self):
        return bool(self.ws_url)

    def start(self):
        if not self.enabled or (self._thread and self._thread.is_alive()):
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="vera-vella-telemetry-ws",
            daemon=True,
        )
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=3.0)

    def _run(self):
        while not self._stop.is_set():
            url = self.ws_url
            if not url:
                self._stop.wait(2.0)
                continue
            try:
                print("[vera-ws] Connecting to Vella WebSocket telemetry at %s" % url)
                with websockets.sync.client.connect(url, open_timeout=5, close_timeout=2) as ws:
                    print("[vera-ws] Connected to Vella WebSocket telemetry at %s" % url)
                    while not self._stop.is_set():
                        payload = self.controller.telemetry_stream_payload()
                        ws.send(json.dumps(payload, default=str))
                        if self._stop.wait(self.interval_s):
                            break
            except Exception as exc:
                if not self._stop.is_set():
                    print("[vera-ws] Telemetry stream error (%s); reconnecting in 2s..." % exc)
                    self._stop.wait(2.0)
