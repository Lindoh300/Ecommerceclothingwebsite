import { useCallback, useEffect, useState } from "react";

export function ProductImage({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
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
      <div role="img" aria-label={alt} className={["flex h-full w-full items-center justify-center bg-b5", className].filter(Boolean).join(" ")}>
        <span className="micro text-b60" aria-hidden="true">No photo</span>
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
