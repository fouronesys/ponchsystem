import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  attachStreamAndWaitForFrames,
  CameraPreparationError,
  stopMediaStream,
  waitForMountedVideo,
} from "@/lib/camera";

type SelfieCaptureProps = {
  disabled?: boolean;
  onCaptured: (image: string) => void;
};

export function SelfieCapture({ disabled, onCaptured }: SelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraState, setCameraState] = useState<"starting" | "ready">("starting");

  const stop = () => {
    generationRef.current += 1;
    stopMediaStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    setOpen(false);
  };

  useEffect(() => () => stop(), []);

  const start = async () => {
    setError(null);
    setCameraState("starting");
    setOpen(true);
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Este navegador no admite la cámara.");
      }

      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (generationRef.current !== generation) {
          stopMediaStream(stream, null);
          return;
        }
        streamRef.current = stream;
        try {
          const video = await waitForMountedVideo(videoRef);
          await attachStreamAndWaitForFrames(video, stream);
          if (generationRef.current !== generation) {
            stopMediaStream(stream, video);
            return;
          }
          setCameraState("ready");
          return;
        } catch (reason) {
          lastError = reason;
          stopMediaStream(stream, videoRef.current);
          streamRef.current = null;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new CameraPreparationError();
    } catch (reason) {
      stop();
      setError(
        reason instanceof Error && reason.message.includes("no admite")
          ? reason.message
          : "Debes permitir el uso de la cámara frontal para continuar.",
      );
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || cameraState !== "ready") return;
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
           <Button type="button" className="flex-1" onClick={capture} disabled={cameraState !== "ready"}>
             {cameraState === "starting" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
             {cameraState === "starting" ? "Preparando cámara…" : "Tomar selfie"}
           </Button>
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