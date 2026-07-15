import { useState } from 'react'

const PLACEHOLDER_SRC =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">' +
      '<rect width="160" height="90" fill="#ccc"/>' +
      '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#666" font-size="10">No preview</text>' +
      '</svg>',
  )

export interface ThumbnailImageProps {
  src: string | null
  alt: string
}

/** Task 22.7 / Property 19: shows a placeholder if the thumbnail fails to
 * load (or there is none), instead of leaving the cell blank. */
export function ThumbnailImage({ src, alt }: ThumbnailImageProps) {
  const [failed, setFailed] = useState(false)
  const resolvedSrc = !src || failed ? PLACEHOLDER_SRC : src
  return (
    <img
      src={resolvedSrc}
      alt={alt}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}

export default ThumbnailImage
