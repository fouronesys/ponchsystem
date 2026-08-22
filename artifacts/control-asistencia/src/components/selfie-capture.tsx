import { useEffect, useRef, useState } from "react";
import { Camera, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type SelfieCaptureProps = {
  disabled?: boolean;
  onCaptured: (image: string) => void;
};

export function SelfieCapture({ disabled, onCaptured }: SelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setOpen(false);
  };

  useEffect(() => () => stop(), []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError("Debes permitir el uso de la cámara frontal para continuar.");
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      640,
      640,
    );
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    stop();
    onCaptured(dataUrl);
  };

  if (open) {
    return (
      <div className="overflow-hidden rounded-xl border bg-slate-950">
        <div className="relative aspect-square">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-[16%] rounded-full border-2 border-white/80 shadow-[0_0_0_999px_rgba(2,6,23,.38)]" />
          <Button type="button" variant="secondary" size="icon" onClick={stop} className="absolute right-3 top-3" aria-label="Cerrar cámara">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2 p-3">
          <Button type="button" className="flex-1" onClick={capture}><Camera className="mr-2 h-4 w-4" />Tomar selfie</Button>
          <Button type="button" variant="outline" onClick={stop}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={() => void start()} disabled={disabled} className="w-full">
        <Camera className="mr-2 h-4 w-4" />Tomar selfie obligatoria
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}