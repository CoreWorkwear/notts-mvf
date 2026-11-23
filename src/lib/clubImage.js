// The fragment is attached only after both uploads succeed. It never goes to
// Storage. Old URLs and single-size uploads continue to use the original.
export function imageCandidates(src) {
  const match = typeof src === 'string' && /^(https?:\/\/[^#?]+)\.(webp|png|jpg)#mvf=(\d+),(\d+)$/.exec(src)
  if (!match) return undefined
  const [, stem, ext, small, large] = match
  if (Number(small) < 1 || Number(large) <= Number(small)) return undefined
  return `${stem}-thumb.${ext} ${small}w, ${stem}.${ext} ${large}w`
}
