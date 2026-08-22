import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Detector = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};

type DetectorConstructor = new (options: {
  formats: string[];
}) => Detector;

declare global {
  interface Window {
    BarcodeDetector?: DetectorConstructor;
  }
}

type QrScannerProps = {
  disabled?: boolean;
  onDetected: (token: string) => void;
};

export function QrScanner({ disabled, onDetected }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "starting" | "unsupported" | "denied">(
    "idle",
  );

  const stopScanner = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsOpen(false);
  };

  useEffect(() => () => stopScanner(), []);

  const startScanner = async () => {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setIsOpen(true);
      setStatus("idle");

      window.setTimeout(() => {
        const video = videoRef.current;
        const DetectorClass = window.BarcodeDetector;
        if (!video || !DetectorClass || !streamRef.current) return;
        video.srcObject = streamRef.current;
        void video.play();
        const detector = new DetectorClass({ formats: ["qr_code"] });

        const scan = async () => {
          if (!streamRef.current) return;
          try {
            const codes = await detector.detect(video);
            const token = codes[0]?.rawValue?.trim();
            if (token) {
              stopScanner();
              onDetected(token);
              return;
            }
          } catch {
            // A single frame may be unavailable while the camera is warming up.
          }
          frameRef.current = requestAnimationFrame(() => void scan());
        };
        void scan();
      }, 0);
    } catch {
      setStatus("denied");
      setIsOpen(false);
    }
  };

  if (isOpen) {
    return (
      <div className="overflow-hidden rounded-xl border bg-slate-950">
        <div className="relative aspect-square">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
          />
          <div className="pointer-events-none absolute inset-[15%] rounded-lg border-2 border-white/80 shadow-[0_0_0_999px_rgba(2,6,23,0.38)]" />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={stopScanner}
            className="absolute right-3 top-3"
            aria-label="Cerrar cámara"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="p-3 text-center text-sm text-slate-200">
          Alinea el QR dentro del marco para validar tu registro.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => void startScanner()}
        disabled={disabled || status === "starting"}
      >
        {status === "starting" ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <ScanLine className="mr-2 h-4 w-4" />
        )}
        Escanear QR con cámara
      </Button>
      {status === "unsupported" && (
        <p className="text-xs text-muted-foreground">
          Este navegador no admite escaneo directo. Usa el código manual.
        </p>
      )}
      {status === "denied" && (
        <p className="text-xs text-destructive">
          No pudimos abrir la cámara. Revisa el permiso e inténtalo de nuevo.
        </p>
      )}
    </div>
  );
}