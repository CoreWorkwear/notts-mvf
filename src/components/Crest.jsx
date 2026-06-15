import { useAuth } from '../context/AuthContext'

// Club crest. Real badge comes from Storage (clubs.crest_url); defaults to the
// signed-in club's crest when no explicit url is passed. Fallback: a modern
// monogram on the signature red/green diagonal split — a place identity, NOT
// Robin Hood folklore (DESIGN-SYSTEM §8).
export default function Crest({ url, size = 30 }) {
  const { club } = useAuth()
  const src = url ?? club?.crest_url
  if (src) {
    return (
      <img
        src={src}
        alt="Nottinghamshire MvF crest"
        width={size}
        height={size}
        style={{ borderRadius: 8, objectFit: 'cover' }}
      />
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-label="Nottinghamshire MvF" role="img">
      <defs>
        <clipPath id="crest-r"><rect width="40" height="40" rx="9" /></clipPath>
      </defs>
      <g clipPath="url(#crest-r)">
        <rect width="40" height="40" fill="#141815" />
        <path d="M0 0 H40 V40 Z" fill="#2FA84F" opacity="0.9" />
        <path d="M0 0 H40 L0 40 Z" fill="#E11D2A" />
        <path d="M0 0 L40 40" stroke="#0c0f0d" strokeWidth="2" />
      </g>
      <text
        x="20" y="26" textAnchor="middle"
        fontFamily="'Clash Display', sans-serif" fontWeight="700" fontSize="15" fill="#F2F0EC"
      >
        N
      </text>
    </svg>
  )
}
