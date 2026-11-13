"""nimbus-ml: optional CPU service for speech search, picture search and face grouping."""
import gc, io, os, subprocess, threading, time, urllib.request
from pathlib import Path

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel

VERSION = "0.1.0"
MODELS = Path(os.environ.get("MODELS_DIR", "/models"))
TOKEN = os.environ.get("ML_TOKEN", "")
IDLE = int(os.environ.get("IDLE_UNLOAD_SEC", "300"))

HF = "https://huggingface.co/immich-app/{}/resolve/main/"
ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models/"
# model -> {local file: url}; clip text lives in the same folder
CLIP = {
    "vitb32": {  # English OpenAI ViT-B/32, 512-d
        "visual.onnx": HF.format("ViT-B-32__openai") + "visual/model.onnx",
        "textual.onnx": HF.format("ViT-B-32__openai") + "textual/model.onnx",
        "tokenizer.json": HF.format("ViT-B-32__openai") + "textual/tokenizer.json",
    },
    "multilingual": {  # XLM-Roberta-Base text tower + ViT-B/32 (LAION-5B), 512-d
        "visual.onnx": HF.format("XLM-Roberta-Base-ViT-B-32__laion5b_s13b_b90k") + "visual/model.onnx",
        "textual.onnx": HF.format("XLM-Roberta-Base-ViT-B-32__laion5b_s13b_b90k") + "textual/model.onnx",
        "tokenizer.json": HF.format("XLM-Roberta-Base-ViT-B-32__laion5b_s13b_b90k") + "textual/tokenizer.json",
    },
}
FACES = {
    "default": {
        "yunet.onnx": ZOO + "face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "sface.onnx": ZOO + "face_recognition_sface/face_recognition_sface_2021dec_int8.onnx",
    }
}
WHISPER = ("tiny", "base", "small", "medium")
FEATURES = {"speech": WHISPER, "clip": tuple(CLIP), "faces": ("default",)}


def rss_mb() -> int:
    with open("/proc/self/statm") as f:
        return int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") // 2**20


def auth(authorization: str = Header(default="")):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")


app = FastAPI(title="nimbus-ml")
guarded = [Depends(auth)]

# ---------------------------------------------------------------- model files


def folder(feature: str, model: str) -> Path:
    return MODELS / feature / model


def on_disk(feature: str, model: str) -> bool:
    return (folder(feature, model) / "ready").exists()


def need(feature: str, model: str) -> Path:
    if model not in FEATURES[feature] or not on_disk(feature, model):
        raise HTTPException(409, f"{feature} model {model} is not downloaded")
    return folder(feature, model)


status: dict = {}  # feature -> {model, state, progress, error}
for _f, _ms in FEATURES.items():
    _have = [m for m in _ms if on_disk(_f, m)]
    status[_f] = {"model": _have[0] if _have else None, "state": "ready" if _have else "missing",
                  "progress": 1 if _have else 0, "error": None}


def download(url: str, dest: Path, done: list, total: int, feature: str):
    tmp = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as out:
        while chunk := r.read(1 << 20):
            out.write(chunk)
            done[0] += len(chunk)
            status[feature]["progress"] = round(done[0] / total, 3)
    tmp.rename(dest)


def pull(feature: str, model: str):
    st = status[feature]
    try:
        d = folder(feature, model)
        d.mkdir(parents=True, exist_ok=True)
        if feature == "speech":
            from faster_whisper.utils import download_model
            download_model(model, output_dir=str(d))
        else:
            files = (CLIP if feature == "clip" else FACES)[model]
            sizes = {}
            for name, url in files.items():
                req = urllib.request.Request(url, method="HEAD")
                with urllib.request.urlopen(req, timeout=60) as r:
                    sizes[name] = int(r.headers.get("Content-Length") or 0)
            total, done = sum(sizes.values()) or 1, [0]
            for name, url in files.items():
                download(url, d / name, done, total, feature)
        (d / "ready").touch()
        st.update(state="ready", progress=1, error=None)
    except Exception as e:  # reported through /health
        st.update(state="failed", error=str(e)[:300])


class Pull(BaseModel):
    feature: str
    model: str


@app.post("/models/pull", dependencies=guarded)
def models_pull(b: Pull):
    if b.feature not in FEATURES or b.model not in FEATURES[b.feature]:
        raise HTTPException(400, "unknown feature or model")
    if any(s["state"] == "downloading" for s in status.values()):
        raise HTTPException(409, "a download is already running")
    status[b.feature].update(model=b.model, state="downloading", progress=0, error=None)
    threading.Thread(target=pull, args=(b.feature, b.model), daemon=True).start()
    return {"ok": True}


# -------------------------------------------------------------- model manager
# ponytail: one global lock for all heavy models, so a transcript blocks a face
# request; per-model locks would need refcounted unloading.
heavy = threading.Lock()
loaded: dict = {"key": None, "obj": None, "used": 0.0}
text_enc: dict = {}  # model -> (session, tokenizer); never unloaded


def unload():
    loaded.update(key=None, obj=None)
    gc.collect()


def use(key: tuple, loader):
    """Call with `heavy` held. Loads `key`, unloading whatever else was loaded."""
    if loaded["key"] != key:
        unload()
        loaded.update(key=key, obj=loader())
    loaded["used"] = time.time()
    return loaded["obj"]


def reaper():
    while True:
        time.sleep(15)
        if loaded["key"] and time.time() - loaded["used"] > IDLE and heavy.acquire(blocking=False):
            try:
                if time.time() - loaded["used"] > IDLE:
                    unload()
            finally:
                heavy.release()


threading.Thread(target=reaper, daemon=True).start()


@app.get("/health")
def health():
    # `models`: the last download per feature; `ready`: every model on disk, per feature.
    return {"version": VERSION, "loaded": [loaded["key"]] if loaded["key"] else [],
            "textLoaded": list(text_enc), "models": status,
            "ready": {f: [m for m in ms if on_disk(f, m)] for f, ms in FEATURES.items()}, "rssMb": rss_mb()}


# --------------------------------------------------------------------- speech


class Transcribe(BaseModel):
    url: str
    maxSec: int = 3600
    model: str = "base"


@app.post("/transcribe", dependencies=guarded)
def transcribe(b: Transcribe):
    if not b.url.startswith(("http://", "https://")):
        raise HTTPException(400, "url must be http(s)")
    d = need("speech", b.model)
    p = subprocess.run(
        ["nice", "-n", "19", "ffmpeg", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "http,https,tcp,tls,crypto",
         "-t", str(b.maxSec), "-i", b.url, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        capture_output=True, timeout=b.maxSec + 600)
    if p.returncode != 0:
        err = p.stderr.decode()
        if "does not contain any stream" in err:  # no audio track
            return {"lang": None, "noSpeech": True, "segments": []}
        raise HTTPException(422, "ffmpeg: " + err[-200:])
    audio = np.frombuffer(p.stdout, np.int16).astype(np.float32) / 32768
    if len(audio) < 1600:
        return {"lang": None, "noSpeech": True, "segments": []}

    def load():
        from faster_whisper import WhisperModel
        return WhisperModel(str(d), device="cpu", compute_type="int8")

    with heavy:
        m = use(("speech", b.model), load)
        segs, info = m.transcribe(audio, vad_filter=True, beam_size=1)
        out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
        loaded["used"] = time.time()
    out = [s for s in out if s["text"]]
    return {"lang": info.language, "noSpeech": not out, "segments": out}


# ----------------------------------------------------------------------- clip


def session(path: Path):
    import onnxruntime as ort
    return ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)


def prep(data: bytes) -> np.ndarray:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = im.size
    s = 224 / min(w, h)
    im = im.resize((max(224, round(w * s)), max(224, round(h * s))), Image.BICUBIC)
    l, t = (im.width - 224) // 2, (im.height - 224) // 2
    a = np.asarray(im.crop((l, t, l + 224, t + 224)), np.float32) / 255
    return ((a - MEAN) / STD).transpose(2, 0, 1)


@app.post("/clip/images", dependencies=guarded)
def clip_images(files: list[UploadFile] = File(...), model: str = Form("vitb32")):
    d = need("clip", model)
    try:
        batch = [prep(f.file.read())[None] for f in files]
    except Exception:
        raise HTTPException(400, "unreadable image")
    with heavy:
        s = use(("clip", model), lambda: session(d / "visual.onnx"))
        name = s.get_inputs()[0].name
        # the exported visual model has a fixed batch of 1
        v = np.concatenate([s.run(None, {name: b})[0] for b in batch])
    return {"vectors": unit(v).tolist()}


class Text(BaseModel):
    q: str
    model: str = "vitb32"


@app.post("/clip/text", dependencies=guarded)
def clip_text(b: Text):
    d = need("clip", b.model)
    if b.model not in text_enc:
        from tokenizers import Tokenizer
        tok = Tokenizer.from_file(str(d / "tokenizer.json"))
        tok.enable_truncation(77)
        tok.enable_padding(length=77, pad_id=tok.token_to_id("<pad>") or 0)
        text_enc[b.model] = (session(d / "textual.onnx"), tok)
    s, tok = text_enc[b.model]
    enc = tok.encode(b.q)
    feeds = {}
    for i in s.get_inputs():
        arr = enc.attention_mask if "mask" in i.name else enc.ids
        feeds[i.name] = np.array([arr], np.int32 if "int32" in i.type else np.int64)
    return {"vector": unit(s.run(None, feeds)[0])[0].tolist()}


# ---------------------------------------------------------------------- faces


class Faces:
    def __init__(self, d: Path):
        self.det = cv2.FaceDetectorYN.create(str(d / "yunet.onnx"), "", (320, 320), 0.7)
        self.rec = cv2.FaceRecognizerSF.create(str(d / "sface.onnx"), "")


@app.post("/faces", dependencies=guarded)
def faces(file: UploadFile = File(...)):
    d = need("faces", "default")
    img = cv2.imdecode(np.frombuffer(file.file.read(), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "unreadable image")
    h0, w0 = img.shape[:2]
    scale = min(1, 1600 / max(h0, w0))
    if scale < 1:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    h, w = img.shape[:2]
    out = []
    with heavy:
        f = use(("faces", "default"), lambda: Faces(d))
        f.det.setInputSize((w, h))
        _, rows = f.det.detect(img)
        for r in rows if rows is not None else []:
            x, y, bw, bh = (float(v) for v in r[:4])
            if min(bw, bh) / scale < 40:
                continue
            vec = f.rec.feature(f.rec.alignCrop(img, r))[0]
            x0, y0 = max(0, x), max(0, y)
            out.append({
                "box": [x0 / w, y0 / h, min(w - x0, bw - (x0 - x)) / w, min(h - y0, bh - (y0 - y)) / h],
                "score": float(r[14]), "vec": unit(vec.astype(np.float64)).tolist()})
    return {"faces": out}
