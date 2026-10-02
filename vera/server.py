"""Small local HTTP interface for the independent Vera process."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from vera.config import VERA_HOST, VERA_PORT
from vera.controller import VeraController
from vera.mission_request import MissionRequest, MissionValidationError
from vera.registration import VellaRegistrar


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

    def _body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

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
                request = MissionRequest.from_dict(body)
                mission, created = self.controller.submit(request)
                return self._send(202 if created else 200, mission)
            if path == "/commands":
                result = self.controller.command(body["command"], body.get("mission_id"))
                return self._send(200, result)
            return self._send(404, {"detail": "not found"})
        except MissionValidationError as exc:
            return self._send(400, {"detail": str(exc)})
        except ValueError as exc:
            return self._send(409, {"detail": str(exc)})
        except KeyError as exc:
            return self._send(404, {"detail": str(exc)})
        except RuntimeError as exc:
            return self._send(503, {"detail": str(exc)})
        except Exception as exc:
            return self._send(500, {"detail": str(exc)})


def serve(controller=None, host=VERA_HOST, port=VERA_PORT, registrar=None):
    controller = controller or VeraController()
    controller.start()
    server = create_server(controller, host, port)
    print("Vera independent process listening on http://%s:%s" % (host, server.server_port))
    registrar = registrar or VellaRegistrar(controller)
    registrar.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        registrar.stop()
        controller.stop()


def create_server(controller, host=VERA_HOST, port=VERA_PORT):
    """Create a server for embedding or tests; the controller remains separate."""
    VeraRequestHandler.controller = controller
    return ThreadingHTTPServer((host, port), VeraRequestHandler)
