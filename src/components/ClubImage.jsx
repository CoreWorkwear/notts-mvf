import { imageCandidates } from '../lib/clubImage'

export default function ClubImage({ src, width, sizes, loading = 'lazy', ...props }) {
  return <img {...props} src={src} srcSet={imageCandidates(src)}
    sizes={sizes || (typeof width === 'number' ? width + 'px' : undefined)}
    width={width} loading={loading} decoding="async" />
}
