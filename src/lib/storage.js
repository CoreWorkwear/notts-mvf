import { supabase } from './supabase'

const extensions = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif', 'image/gif': 'gif' }

async function renderAt(image, width, quality = 0.82) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.max(1, Math.round(image.height * width / image.width))
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  // Encoders without WebP support return PNG, preserving transparent badges.
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality))
  if (!blob) throw new Error('Image could not be resized')
  return blob
}

async function renditions(file, maxDim) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const width = Math.max(1, Math.round(img.width * Math.min(1, maxDim / Math.max(img.width, img.height))))
    const full = await renderAt(img, width)
    const thumb = width > 256 ? await renderAt(img, 256) : null
    return { full, thumb, width }
  } finally { URL.revokeObjectURL(url) }
}

export async function uploadMedia(file, folder, { maxDim = 1200 } = {}) {
  let versions
  try { versions = await renditions(file, maxDim) }
  catch {
    if (!extensions[file.type]) throw new Error('Choose a JPEG, PNG or WebP photo.')
    versions = { full: file }
  }
  const { full, thumb, width } = versions
  const bucket = supabase.storage.from('media')
  const stem = folder + '/' + crypto.randomUUID()
  const ext = extensions[full.type]
  const path = stem + '.' + ext
  const options = { contentType: full.type, upsert: false, cacheControl: '31536000' }
  const { error } = await bucket.upload(path, full, options)
  if (error) throw error
  const original = bucket.getPublicUrl(path).data.publicUrl
  if (thumb && thumb.type === full.type) {
    try {
      const result = await bucket.upload(stem + '-thumb.' + ext, thumb, options)
      if (!result.error) return original + '#mvf=256,' + width
    } catch { /* The original is already usable on every screen. */ }
  }
  return original
}
