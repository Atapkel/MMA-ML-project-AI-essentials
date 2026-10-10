"""Local HTTP API + static frontend using Python's standard library."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit
from inference import Predictor, ROOT
from features import FIELDS

def handler_for(predictor):
    class Handler(BaseHTTPRequestHandler):
        def json_response(self, payload, status=200):
            blob = json.dumps(payload, allow_nan=False).encode('utf-8')
            self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(blob))); self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff'); self.end_headers(); self.wfile.write(blob)

        def do_GET(self):
            route = urlsplit(self.path).path
            if route == '/api/health': return self.json_response({'status': 'ok', 'model': predictor.bundle['selected_model']})
            if route == '/api/fighters': return self.json_response(predictor.catalog)
            if route == '/api/schema': return self.json_response(FIELDS)
            if route == '/api/metrics': return self.json_response(predictor.metrics)
            if route.startswith('/api/'): return self.json_response({'error': 'Endpoint not found.'}, 404)
            if route.startswith('/reports/figures/'):
                base = ROOT/'reports'/'figures'; relative = route.removeprefix('/reports/figures/')
            else:
                base = ROOT/'web'; relative = 'index.html' if route == '/' else route.lstrip('/')
            path = (base/relative).resolve()
            if not path.is_relative_to(base.resolve()) or not path.is_file():
                return self.json_response({'error': 'File not found.'}, 404)
            blob = path.read_bytes()
            self.send_response(200); self.send_header('Content-Type', mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(blob))); self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers(); self.wfile.write(blob)

        def do_POST(self):
            if urlsplit(self.path).path != '/api/predict': return self.json_response({'error': 'Endpoint not found.'}, 404)
            try:
                if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                    return self.json_response({'error': 'Send application/json.'}, 415)
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 65536: return self.json_response({'error': 'Request must be 1–65536 bytes.'}, 413)
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict) or set(payload) != {'fighter_a', 'fighter_b'}:
                    raise ValueError('Request must contain fighter_a and fighter_b only.')
                return self.json_response(predictor.predict(payload['fighter_a'], payload['fighter_b']))
            except (ValueError, TypeError, UnicodeDecodeError) as error:
                return self.json_response({'error': str(error)}, 400)
            except Exception:
                import traceback
                traceback.print_exc()
                return self.json_response({'error': 'Prediction failed. See the local server log.'}, 500)

    return Handler

def main():
    parser = argparse.ArgumentParser(description='FightPredict AI local demonstration server')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--host', default='127.0.0.1', help='Localhost by default; use 0.0.0.0 only for a container or an intentional network demo.')
    args = parser.parse_args()
    try:
        predictor = Predictor()
    except FileNotFoundError:
        parser.exit(1, 'Trained artifacts are missing. Run python train.py first.\n')
    server = ThreadingHTTPServer((args.host, args.port), handler_for(predictor))
    print(f'FightPredict AI: http://127.0.0.1:{args.port}\nModel: {predictor.bundle["selected_model"]}\nPress Ctrl+C to stop.', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__ == '__main__': main()
