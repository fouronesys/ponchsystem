import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachStreamAndWaitForFrames,
  stopMediaStream,
} from "./camera";

class FakeVideo extends EventTarget {
  muted = false;
  playsInline = false;
  readyState = 4;
  videoWidth = 640;
  videoHeight = 480;
  srcObject: MediaStream | null = null;
  paused = false;

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

test("prepara el video cuando ya tiene metadatos y dimensiones", async () => {
  Object.defineProperty(globalThis, "HTMLMediaElement", {
    configurable: true,
    value: { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 },
  });
  const video = new FakeVideo();
  const stream = {
    getTracks: () => [],
  } as unknown as MediaStream;

  await attachStreamAndWaitForFrames(video as unknown as HTMLVideoElement, stream);

  assert.equal(video.srcObject, stream);
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.paused, false);
});

test("detiene las pistas y libera el elemento al cancelar", () => {
  const video = new FakeVideo();
  let stopped = 0;
  const stream = {
    getTracks: () => [{ stop: () => { stopped += 1; } }, { stop: () => { stopped += 1; } }],
  } as unknown as MediaStream;
  video.srcObject = stream;

  stopMediaStream(stream, video as unknown as HTMLVideoElement);

  assert.equal(stopped, 2);
  assert.equal(video.srcObject, null);
  assert.equal(video.paused, true);
});