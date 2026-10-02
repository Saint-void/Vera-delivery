"""Small local HTTP interface for the independent Vera process."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from vera.config import VERA_HOST, VERA_PORT
from vera.controller import VeraController
from vera.mission_request import MissionRequest, MissionValidationError
from vera.registration import VellaRegistrar
from vera.telemetry_client import VellaTelemetryClient


class VeraRequestHandler(BaseHTTPRequestHandler):
    controller = None

    def log_message(self, format, *args):
        print("[vera-http] " + format % args)

    def _send(self, status, payload):
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_chunked(self):
        chunks = []
        while True:
            line = self.rfile.readline()
            if not line:
                break
            chunk_len_str = line.split(b";")[0].strip()
            if not chunk_len_str:
                continue
            try:
                chunk_len = int(chunk_len_str, 16)
            except ValueError:
                break
            if chunk_len == 0:
                while True:
                    trailer = self.rfile.readline()
                    if not trailer or trailer.strip() == b"":
                        break
                break
            chunk_data = self.rfile.read(chunk_len)
            chunks.append(chunk_data)
            self.rfile.read(2)  # consume trailing \r\n
        return b"".join(chunks)

    def _body(self):
        transfer_encoding = self.headers.get("Transfer-Encoding", "").lower()
        if "chunked" in transfer_encoding:
            raw = self._read_chunked()
        else:
            length_header = self.headers.get("Content-Length")
            if length_header is not None:
                length = int(length_header)
                raw = self.rfile.read(length) if length > 0 else b""
            else:
                raw = b""

        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception as exc:
            print("[vera-http] JSON parse error: %s (raw=%r)" % (exc, raw[:100]))
            return {}

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")
        if path in {"", "/health", "/state"}:
            return self._send(200, self.controller.status())
        if path == "/telemetry":
            return self._send(200, self.controller.status()["telemetry"])
        if path == "/missions":
            return self._send(200, self.controller.store.list())
        if path.startswith("/missions/"):
            mission = self.controller.get_mission(path.split("/", 2)[2])
            return self._send(200, mission) if mission else self._send(404, {"detail": "mission not found"})
        return self._send(404, {"detail": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/")
        try:
            body = self._body()
            if path == "/missions":
                print("[vera-http] POST /missions payload: %s" % body)
                request = MissionRequest.from_dict(body)
                mission, created = self.controller.submit(request)
                return self._send(202 if created else 200, mission)
            if path == "/commands":
                command = body.get("command")
                if not command:
                    return self._send(400, {"detail": "command is required"})
                result = self.controller.command(command, body.get("mission_id"))
                return self._send(200, result)
            print("[vera-http] Unknown POST route: %s" % path)
            return self._send(404, {"detail": "not found"})
        except MissionValidationError as exc:
            print("[vera-http] Mission validation rejected: %s" % exc)
            return self._send(400, {"detail": str(exc)})
        except ValueError as exc:
            print("[vera-http] Value error: %s" % exc)
            return self._send(409, {"detail": str(exc)})
        except KeyError as exc:
            print("[vera-http] Missing required key: %s" % exc)
            return self._send(400, {"detail": f"Missing required field: {exc}"})
        except RuntimeError as exc:
            print("[vera-http] Runtime error: %s" % exc)
            return self._send(503, {"detail": str(exc)})
        except Exception as exc:
            print("[vera-http] Internal server error: %s" % exc)
            return self._send(500, {"detail": str(exc)})



def serve(controller=None, host=VERA_HOST, port=VERA_PORT, registrar=None, telemetry_client=None):
    controller = controller or VeraController()
    controller.start()
    server = create_server(controller, host, port)
    print("Vera independent process listening on http://%s:%s" % (host, server.server_port))
    registrar = registrar or VellaRegistrar(controller)
    registrar.start()
    telemetry_client = telemetry_client or VellaTelemetryClient(controller)
    telemetry_client.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        telemetry_client.stop()
        registrar.stop()
        controller.stop()


def create_server(controller, host=VERA_HOST, port=VERA_PORT):
    """Create a server for embedding or tests; the controller remains separate."""
    VeraRequestHandler.controller = controller
    return ThreadingHTTPServer((host, port), VeraRequestHandler)
