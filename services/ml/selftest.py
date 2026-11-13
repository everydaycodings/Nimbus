"""Pulls tiny / vitb32 / faces, runs each endpoint on a sample, asserts shapes, prints RSS.
Run inside the container: docker compose exec ml python selftest.py"""
import http.server, io, math, os, struct, tempfile, threading, time, urllib.request, wave
from functools import partial

from fastapi.testclient import TestClient

import main

c = TestClient(main.app)
H = {"Authorization": f"Bearer {main.TOKEN}"} if main.TOKEN else {}
SELFIE = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/example_outputs/largest_selfie.jpg"


def rss(label):
    print(f"RSS after {label}: {c.get('/health').json()['rssMb']} MB")


def pull(feature, model):
    assert c.post("/models/pull", json={"feature": feature, "model": model}, headers=H).status_code == 200
    while (st := c.get("/health").json()["models"][feature])["state"] == "downloading":
        time.sleep(2)
    assert st["state"] == "ready", st


def jpeg(color):
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (320, 240), color).save(b, "JPEG")
    return b.getvalue()


assert c.get("/health").status_code == 200
if main.TOKEN:
    assert c.post("/clip/text", json={"q": "x"}).status_code == 401
rss("start")
pull("speech", "tiny"), pull("clip", "vitb32"), pull("faces", "default")

d = tempfile.mkdtemp()
with wave.open(f"{d}/tone.wav", "wb") as w:
    w.setnchannels(1), w.setsampwidth(2), w.setframerate(16000)
    w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(i / 20))) for i in range(16000 * 3)))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), partial(http.server.SimpleHTTPRequestHandler, directory=d))
threading.Thread(target=srv.serve_forever, daemon=True).start()
r = c.post("/transcribe", json={"url": f"http://127.0.0.1:{srv.server_port}/tone.wav", "maxSec": 60, "model": "tiny"}, headers=H).json()
assert r["noSpeech"] is True and r["segments"] == [], r
rss("whisper tiny")

r = c.post("/clip/images", files=[("files", ("a.jpg", jpeg("red"))), ("files", ("b.jpg", jpeg("blue")))], data={"model": "vitb32"}, headers=H).json()
assert len(r["vectors"]) == 2 and len(r["vectors"][0]) == 512
assert abs(math.sqrt(sum(x * x for x in r["vectors"][0])) - 1) < 1e-3
rss("clip visual")
t = c.post("/clip/text", json={"q": "a red square", "model": "vitb32"}, headers=H).json()["vector"]
assert len(t) == 512 and abs(math.sqrt(sum(x * x for x in t)) - 1) < 1e-3
rss("clip text (visual unloaded? no: text stays)")

img = urllib.request.urlopen(SELFIE).read()
r = c.post("/faces", files={"file": ("s.jpg", img)}, headers=H).json()["faces"]
assert r, "no faces found"
f = r[0]
assert len(f["box"]) == 4 and all(0 <= v <= 1 for v in f["box"]) and len(f["vec"]) == 128 and f["score"] > 0.7
print(f"faces found: {len(r)}")
rss("faces")
print("health loaded:", c.get("/health").json()["loaded"])
print("selftest ok")
