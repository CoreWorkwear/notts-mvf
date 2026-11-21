import { expect, test } from 'vitest'
import { imageCandidates } from './clubImage'

test('advertises only successfully uploaded candidates and leaves existing images intact', () => {
  const src = 'https://example.supabase.co/storage/v1/object/public/media/photos/x.webp'
  expect(imageCandidates(src)).toBeUndefined()
  expect(imageCandidates(src + '#mvf=256,1000')).toBe(src.replace('.webp', '-thumb.webp') + ' 256w, ' + src + ' 1000w')
  expect(imageCandidates(src + '#mvf=0,1000')).toBeUndefined()
})
