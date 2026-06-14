// Fixed full-screen grain (DESIGN-SYSTEM §3). Kills the "void-like" flat dark
// and gradient banding on heroes. ~3-5% opacity, soft-light, non-interactive.
export default function GrainOverlay() {
  return (
    <svg className="grain" aria-hidden="true">
      <filter id="grain-noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain-noise)" />
    </svg>
  )
}
