import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";

// A browser BarcodeDetector when there is one, else jsQR (loaded on demand) reading frames from the camera video.
interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (options: { formats: string[] }) => DetectorLike;
type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;

const FRAME_MS = 200;
const SCAN_WIDTH = 480;

/**
 * The camera scanner. Starts only when the person taps the button (a camera needs a tap), reads QR codes and calls
 * `onCode` with their text. The same code is not reported again within `repeatMs`. Manual entry lives in the
 * parent, so this can fail (no camera, permission refused) without blocking the door.
 */
export function DoorScanner({ onCode, repeatMs = 3000 }: { onCode: (text: string) => void; repeatMs?: number }) {
  const [state, setState] = useState<"idle" | "starting" | "on" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const onCodeRef = useRef(onCode);
  const last = useRef<{ text: string; at: number } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    onCodeRef.current = onCode;
  });

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
    };
  }, [stop]);

  const start = async () => {
    if (state === "starting" || state === "on") return;
    setState("starting");
    setMessage(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't open the camera.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("No video element");
      video.srcObject = stream;
      await video.play();

      let detector: DetectorLike | null = null;
      const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (Ctor) {
        try {
          detector = new Ctor({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      let jsQR: JsQr | null = null;
      const loadJsQr = async () => {
        if (!jsQR) jsQR = (await import("jsqr")).default as unknown as JsQr;
      };
      if (!detector) await loadJsQr();
      if (!alive.current) return;
      setState("on");

      const report = (text: string) => {
        const now = Date.now();
        if (last.current && last.current.text === text && now - last.current.at < repeatMs) return;
        last.current = { text, at: now };
        onCodeRef.current(text);
      };

      const tick = async () => {
        if (!alive.current || !streamRef.current) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            if (detector) {
              try {
                const found = await detector.detect(video);
                if (found[0]?.rawValue) report(found[0].rawValue);
              } catch {
                // The detector failed on this device: carry on with jsQR.
                detector = null;
                await loadJsQr();
              }
            } else if (jsQR) {
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext("2d", { willReadFrequently: true });
              if (canvas && ctx) {
                const scale = Math.min(1, SCAN_WIDTH / video.videoWidth);
                canvas.width = Math.round(video.videoWidth * scale);
                canvas.height = Math.round(video.videoHeight * scale);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
                if (found?.data) report(found.data);
              }
            }
          }
        } catch {
          // A bad frame is skipped.
        }
        if (alive.current && streamRef.current) timerRef.current = window.setTimeout(tick, FRAME_MS);
      };
      timerRef.current = window.setTimeout(tick, FRAME_MS);
    } catch (err) {
      stop();
      if (!alive.current) return;
      setState("error");
      setMessage(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission was refused. Allow it in the browser, or type the code below."
          : "The camera could not be opened. Type the code below instead.",
      );
    }
  };

  const handleStop = () => {
    stop();
    setState("idle");
  };

  return (
    <div>
      <div className={`${state === "on" || state === "starting" ? "" : "hidden"} border border-b10 bg-b5 mb-3`}>
        <video ref={videoRef} playsInline muted className="w-full max-h-72 object-cover" aria-label="Camera view" />
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      {state === "on" || state === "starting" ? (
        <button type="button" onClick={handleStop} className="cta">
          <CameraOff className="w-5 h-5" />
          Stop camera
        </button>
      ) : (
        <button type="button" onClick={start} className="cta">
          <Camera className="w-5 h-5" />
          Scan with camera
        </button>
      )}
      {state === "starting" && <p className="micro text-b60 mt-2">Starting the camera…</p>}
      {message && (
        <p role="alert" className="text-sm text-b60 mt-2">
          {message}
        </p>
      )}
    </div>
  );
}
