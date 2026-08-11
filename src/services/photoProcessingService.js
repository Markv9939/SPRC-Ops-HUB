import { MAX_PHOTO_EDGE, PHOTO_JPEG_QUALITY, validateProcessedPhoto } from '../utils/photoModel'

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Photo could not be encoded.')), 'image/jpeg', quality)
  })
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' })
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function processIssuePhoto(file) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose an image file.')
  const image = await loadImage(file)
  const sourceWidth = Number(image.width)
  const sourceHeight = Number(image.height)
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Photo processing is unavailable in this browser.')
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  image.close?.()
  const blob = await canvasToBlob(canvas, PHOTO_JPEG_QUALITY)
  const processed = { blob, size: blob.size, type: blob.type, width, height }
  validateProcessedPhoto(processed)
  return processed
}
