export class CameraPreparationError extends Error {
  constructor(message = "La cámara no entregó video.") {
    super(message);
    this.name = "CameraPreparationError";
  }
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function waitForMountedVideo(
  videoRef: { current: HTMLVideoElement | null },
  timeoutMs = 1500,
): Promise<HTMLVideoElement> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (videoRef.current) return videoRef.current;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  throw new CameraPreparationError("No pudimos preparar la vista previa de la cámara.");
}

async function waitForMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new CameraPreparationError("La cámara no entregó sus metadatos."));
    }, timeoutMs);
    const onMetadata = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onMetadata);
    };
    video.addEventListener("loadedmetadata", onMetadata, { once: true });
  });
}

async function waitForFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  const withFrameCallback = video as VideoWithFrameCallback;
  if (typeof withFrameCallback.requestVideoFrameCallback === "function") {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new CameraPreparationError("La cámara no entregó imágenes."));
      }, timeoutMs);
      withFrameCallback.requestVideoFrameCallback(() => {
        window.clearTimeout(timeout);
        resolve();
      });
    });
    return;
  }

  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    await wait(50);
  }
  throw new CameraPreparationError("La cámara no entregó imágenes.");
}

export async function attachStreamAndWaitForFrames(
  video: HTMLVideoElement,
  stream: MediaStream,
): Promise<void> {
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await waitForMetadata(video, 3000);
  await video.play();
  await waitForFrame(video, 3000);
}

export function stopMediaStream(
  stream: MediaStream | null,
  video: HTMLVideoElement | null,
): void {
  if (video) {
    video.pause();
    video.srcObject = null;
  }
  stream?.getTracks().forEach((track) => track.stop());
}