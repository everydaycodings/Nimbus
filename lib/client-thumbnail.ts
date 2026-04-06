// lib/client-thumbnail.ts
import * as pdfjsLib from "pdfjs-dist"

// Setting worker for PDF.js (using unpkg for convenience on the client)
// This reduces bundle size significantly.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

export async function generateClientThumbnail(
  file: File
): Promise<Blob | null> {
  if (file.type.startsWith("image/")) {
    return generateImageThumbnail(file)
  } else if (file.type.startsWith("video/")) {
    return generateVideoThumbnail(file)
  } else if (file.type === "application/pdf") {
    return generatePdfThumbnail(file)
  }
  return null
}

async function generateImageThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const MAX_SIZE = 300
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width
            width = MAX_SIZE
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height
            height = MAX_SIZE
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        ctx?.drawImage(img, 0, 0, width, height)
        canvas.toBlob((blob) => resolve(blob), "image/webp", 0.8)
      }
      img.onerror = () => resolve(null)
      img.src = e.target?.result as string
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

async function generateVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video")
    const url = URL.createObjectURL(file)

    video.autoplay = false
    video.muted = true
    video.src = url

    video.onloadedmetadata = () => {
      const safeTime = Math.min(1, video.duration / 2 || 0.1)
      video.currentTime = safeTime
    }

    video.onseeked = () => {
      const canvas = document.createElement("canvas")
      const MAX_SIZE = 300
      let width = video.videoWidth
      let height = video.videoHeight

      if (width > height) {
        if (width > MAX_SIZE) {
          height *= MAX_SIZE / width
          width = MAX_SIZE
        }
      } else {
        if (height > MAX_SIZE) {
          width *= MAX_SIZE / height
          height = MAX_SIZE
        }
      }

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      ctx?.drawImage(video, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url)
          resolve(blob)
        },
        "image/webp",
        0.8
      )
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
  })
}

async function generatePdfThumbnail(file: File): Promise<Blob | null> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdf = await loadingTask.promise

    // Get first page
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1.0 })

    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    const MAX_SIZE = 300
    let width = viewport.width
    let height = viewport.height

    // Adjust scale to fit max size
    const scale = Math.min(MAX_SIZE / width, MAX_SIZE / height)
    const scaledViewport = page.getViewport({ scale })

    canvas.width = scaledViewport.width
    canvas.height = scaledViewport.height

    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport,
    }).promise

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/webp", 0.8)
    })
  } catch (error) {
    console.error(
      "[pdf-thumb] Failed to generate PDF thumbnail client-side:",
      error
    )
    return null
  }
}
