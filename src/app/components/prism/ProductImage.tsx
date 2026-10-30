import { useCallback, useEffect, useState } from "react";
import { GooArt } from "./GooArt";

export function ProductImage({
  src,
  alt,
  seed,
  className,
}: {
  src?: string;
  alt: string;
  seed: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  // The server sends the <img>, so a broken image can fail before React attaches onError. Check
  // for that once the element is mounted.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (!src || failed) {
    return (
      <div role="img" aria-label={alt} className={className} style={{ width: "100%", height: "100%" }}>
        <GooArt seed={seed} cols={4} rows={4} />
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={["h-full w-full object-cover", className].filter(Boolean).join(" ")}
      onError={() => setFailed(true)}
    />
  );
}
