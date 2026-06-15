import { supabase } from './supabase'

const BUCKET = 'media'

// Downscale + recompress an image client-side before upload (mobile-friendly,
// HANDOVER §6). Falls back to the original for non-images / if canvas fails.
export async function resizeImage(file, maxDim = 1200, quality = 0.82) {
  if (!file?.type?.startsWith('image/')) return file
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.onerror = rej
      r.readAsDataURL(file)
    })
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = dataUrl
    })
    let { width, height } = img
    const longest = Math.max(width, height)
    if (longest > maxDim) {
      const scale = maxDim / longest
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file
  }
}

// Resize, upload to the public 'media' bucket under <folder>/<uuid>.jpg, and
// return the public URL. Throws on upload error (RLS: admin only).
export async function uploadMedia(file, folder, { maxDim = 1200 } = {}) {
  const resized = await resizeImage(file, maxDim)
  const path = `${folder}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, resized, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}
