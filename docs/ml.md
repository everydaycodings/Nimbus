# AI features (nimbus-ml)

nimbus-ml is an optional service that runs AI models on your own server's CPU. Nothing is sent anywhere else. It is off until an admin turns a feature on, and Nimbus works fully without it.

The code is in `services/ml` (Python, FastAPI). The Nimbus worker sends it files during its minute sweep, one feature at a time, and stores the results in Postgres.

## What it enables

| Feature | Model | What members get |
|---|---|---|
| Speech search | Whisper (faster-whisper): tiny, base, small or medium | What is said in videos and audio becomes searchable ("Said at 0:32"). A transcript in Details, downloadable as `.srt` or `.txt`, and Auto captions in the video player. Files with no speech are skipped. |
| Search by what's in a photo | CLIP ViT-B/32, English or multilingual | A search like "dog on a beach" finds photos and video frames (every 5 seconds and at scene changes), tagged "Looks like". |
| People | YuNet (face detection) and SFace (recognition) | Faces in members' own photos are grouped into people, who they can name, merge and search for. |

Also: with picture search on, the Documents section can ask nimbus-ml to guess the type of a scanned picture (receipt, ID card and so on). Turn this off in Admin → System → Documents (Guess the type of pictures).

Text in images (OCR) is not part of nimbus-ml. The worker reads text from photos, scanned PDF pages and video frames itself with tesseract.js. It is set in Admin → System → Text in images.

Not processed, ever: vaults, trash and encrypted files. Camera-backup folders go first.

Faces are never shared between accounts. Members can turn face grouping off for themselves (in Account and in Photo settings), which deletes their face data.

## Requirements

- **pgvector.** Picture search and People need the `vector` extension in Postgres (the `pgvector/pgvector` image). Without it those two are greyed out in Admin. Speech search works without it.
- **Memory.** About 3 GB of RAM while working. The container is capped at `NIMBUS_ML_MEMORY` (default `3g`). One model is loaded at a time and unloaded after 5 idle minutes.
- **The multilingual CLIP model needs `NIMBUS_ML_MEMORY` of `4g` or more.** Its text encoder alone is 1.1 GB, and the service reaches about 2.5 GB.
- **Disk.** A few GB for models, kept in the `ml-models` volume (`/models` in the container).
- **CPU only.** No GPU is used.

Audio is transcribed in 10-minute pieces, so a long recording doesn't need more memory than a short one.

## Run it

### On the same server (compose profile)

`./setup.sh` asks "Run the AI service (nimbus-ml)?". Answer yes. It adds `ml` to `COMPOSE_PROFILES` and writes a random `ML_TOKEN` to `.env`.

By hand, in `.env` at the repo root:

```bash
COMPOSE_PROFILES=ml            # add to any profiles you already have, comma-separated
ML_TOKEN=                      # generate with: openssl rand -hex 24
# NIMBUS_ML_MEMORY=3g          # 4g or more for the multilingual photo model
```

Then:

```bash
docker compose up -d --build
```

The app and worker reach the service at `http://ml:8000` (`ML_URL` in `docker-compose.yml`). The service publishes no port on the host. See [install.md](install.md) and [configuration.md](configuration.md).

### On another machine

Build and run the image anywhere the Nimbus server can reach:

```bash
docker build -t nimbus-ml services/ml
docker run -d --name nimbus-ml -p 8000:8000 \
  -e ML_TOKEN=<the same token as the Nimbus server> \
  -v nimbus-ml-models:/models nimbus-ml
```

Then set its address in Admin → AI features → Service address, for example `http://192.168.1.20:8000`, and save to test it. The `ML_URL` environment variable, when set, wins over this field.

The remote machine must be able to read your storage: for speech search it downloads the audio itself from a presigned storage URL.

Keep `ML_TOKEN` the same on both sides. When set, every request except `/health` needs `Authorization: Bearer <ML_TOKEN>`. With it empty, the service accepts anyone, so don't expose it to the internet without one.

## Turn features on

Admin → System → AI features.

1. **Connection.** Shows whether nimbus-ml is reachable, its version, memory use and the loaded model.
2. **Who can use it.** Everyone, or Only chosen members (see below).
3. **Speech search.** Turn on Transcribe speech and pick the Whisper model. Bigger is more accurate and slower.
4. **Search by what's in a photo.** Turn on Look at pictures and pick English (ViT-B/32) or Multilingual.
5. **People.** Turn on Group faces. Choose Opt-in (nobody is scanned until they turn it on, the default) or Opt-out (everyone is, until they turn it off).

Models are not in the image. Saving a feature starts its model download from the service; the page shows its progress. Models come from Hugging Face (`immich-app` CLIP exports), the OpenCV model zoo (faces) and faster-whisper's download source.

Each feature shows how many files are waiting and roughly how long is left. The worker handles a few files a minute. Speech search covers the first minutes of each file up to the limit set under Text in images.

Changing a model redoes that feature for every file. Each feature also has a button to start again from scratch:

| Button | Does |
|---|---|
| Transcribe again | Clears every transcript and makes them again |
| Look again | Indexes every picture again |
| Find faces again | Deletes every face and person, including names members gave, and finds them again |

Admin → Health has an AI service check while a feature is on.

### Allow list

With Who can use it set to Only chosen members, open each member's page under Members and allow them. Files of members who are not allowed are skipped, and they see none of these features. The owner and admins are always included.

## Turn it off

- **One feature:** uncheck it in Admin → AI features. The worker stops processing it from the next sweep.
- **The whole service:** remove `ml` from `COMPOSE_PROFILES` in `.env` (or answer no in `./setup.sh`), then `docker compose up -d --remove-orphans`. To free the disk, delete the `ml-models` volume.

## Service API

For reference. The Nimbus client is `apps/web/lib/ml.ts`.

| Endpoint | Does |
|---|---|
| `GET /health` | Version, loaded model, download state and models on disk per feature, memory in MB. No token needed. |
| `POST /models/pull` | `{ "feature": "speech" \| "clip" \| "faces", "model": "…" }` starts a download. One at a time. |
| `POST /transcribe` | `{ "url", "maxSec", "model" }`: reads audio from the URL and returns language and timed segments. |
| `POST /clip/images` | Multipart images, returns one vector per image. |
| `POST /clip/text` | `{ "q", "model" }`, returns the text vector. |
| `POST /faces` | One multipart image, returns face boxes, scores and vectors. |

Environment variables of the service:

| Variable | Default | Does |
|---|---|---|
| `ML_TOKEN` | empty | Shared secret with the Nimbus server |
| `MODELS_DIR` | `/models` | Where models are stored |
| `IDLE_UNLOAD_SEC` | `300` | Unload the model after this many idle seconds |
