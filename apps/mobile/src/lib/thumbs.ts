// Video thumbnails, which only a client can draw: the server's worker skips video.
import { File } from "expo-file-system"
import { ImageManipulator, SaveFormat, type ImageManipulatorContext } from "expo-image-manipulator"
import { createVideoPlayer, type VideoPlayer } from "expo-video"

const SIZE = 480
const MAX_BYTES = 512 * 1024
const READY_MS = 15_000

// The web's quality first, then lower for a busy frame, to fit what the server accepts.
async function fitWebp(manipulate: () => ImageManipulatorContext) {
  for (const compress of [0.8, 0.6, 0.4]) {
    const image = await manipulate().renderAsync()
    const saved = await image.saveAsync({ format: SaveFormat.WEBP, compress })
    const file = new File(saved.uri)
    const bytes = await file.bytes()
    file.delete()
    if (bytes.length <= MAX_BYTES) return bytes
  }
  throw new Error("That image is too detailed to use as a thumbnail.")
}

export async function frameToWebp(player: VideoPlayer, seconds: number) {
  const [frame] = await player.generateThumbnailsAsync(seconds, { maxWidth: SIZE, maxHeight: SIZE })
  return fitWebp(() => ImageManipulator.manipulate(frame))
}

// Never larger than it was: the longest side comes down to the thumbnail's size.
export async function imageToWebp(uri: string) {
  const { width, height } = await ImageManipulator.manipulate(uri).renderAsync()
  const long = Math.max(width, height)
  return fitWebp(() => {
    const context = ImageManipulator.manipulate(uri)
    if (long > SIZE) context.resize(width >= height ? { width: SIZE } : { height: SIZE })
    return context
  })
}

// For a video not on screen: after Reset thumbnail, nobody else will draw it.
export async function firstFrameToWebp(url: string) {
  const player = createVideoPlayer(url)
  try {
    await new Promise<void>((ok, no) => {
      if (player.status === "readyToPlay") return ok()
      const timer = setTimeout(() => no(new Error("The video took too long to load.")), READY_MS)
      const sub = player.addListener("statusChange", ({ status }) => {
        if (status !== "readyToPlay" && status !== "error") return
        clearTimeout(timer)
        sub.remove()
        if (status === "readyToPlay") ok()
        else no(new Error("Couldn't load the video."))
      })
    })
    return await frameToWebp(player, Math.min(1, player.duration / 2))
  } finally {
    player.release()
  }
}
