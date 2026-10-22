import { useEffect, useState } from "react";
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

  if (!src || failed) {
    return (
      <div role="img" aria-label={alt} className={className} style={{ width: "100%", height: "100%" }}>
        <GooArt seed={seed} cols={4} rows={4} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={["h-full w-full object-cover", className].filter(Boolean).join(" ")}
      onError={() => setFailed(true)}
    />
  );
}
