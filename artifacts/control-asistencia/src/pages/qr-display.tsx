import { useEffect, useRef, useState } from "react";
import {
  getGetQrDisplayStatusQueryKey,
  useGetQrDisplayStatus,
  type QrDisplayStatus,
} from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type DisplayPhase = "ready" | "eating" | "thanks";

function FarbotMascot({ className = "" }: { className?: string }) {
  return (
    <div className={`farbot-3d ${className}`} aria-hidden="true">
      <div className="farbot-antenna"><span /></div>
      <div className="farbot-shadow" />
      <div className="farbot-body">
        <div className="farbot-face">
          <span className="farbot-eye farbot-eye--left" />
          <span className="farbot-eye farbot-eye--right" />
          <div className="farbot-mouth"><span className="farbot-tongue" /><span className="farbot-mouth-paper" /></div>
        </div>
        <div className="farbot-belly" />
        <div className="farbot-bumper" />
      </div>
      <div className="farbot-arm farbot-arm--left" />
      <div className="farbot-arm farbot-arm--right" />
    </div>
  );
}

function preventDisplayShortcuts(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && ["s", "p", "u"].includes(event.key.toLowerCase())) {
    event.preventDefault();
  }
}

export default function QrDisplayPage({ accessToken }: { accessToken: string }) {
  const { data, error, isLoading } = useGetQrDisplayStatus(accessToken, {
    query: {
      queryKey: getGetQrDisplayStatusQueryKey(accessToken),
      refetchInterval: 1_000,
      refetchIntervalInBackground: true,
      retry: false,
    },
  });
  const [visibleQr, setVisibleQr] = useState<QrDisplayStatus | null>(null);
  const [phase, setPhase] = useState<DisplayPhase>("ready");
  const seenScanSequence = useRef<string | null | undefined>(undefined);
  const phaseRef = useRef<DisplayPhase>("ready");
  const pendingQr = useRef<QrDisplayStatus | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    document.title = "FarCheck RD · Código de asistencia";
    const preventContextMenu = (event: Event) => event.preventDefault();
    const preventDrag = (event: Event) => event.preventDefault();
    const preventCopy = (event: Event) => event.preventDefault();
    document.addEventListener("contextmenu", preventContextMenu);
    document.addEventListener("dragstart", preventDrag);
    document.addEventListener("copy", preventCopy);
    document.addEventListener("selectstart", preventCopy);
    document.addEventListener("keydown", preventDisplayShortcuts);
    return () => {
      document.removeEventListener("contextmenu", preventContextMenu);
      document.removeEventListener("dragstart", preventDrag);
      document.removeEventListener("copy", preventCopy);
      document.removeEventListener("selectstart", preventCopy);
      document.removeEventListener("keydown", preventDisplayShortcuts);
    };
  }, []);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!data) return;
    const previousSequence = seenScanSequence.current;
    if (previousSequence === undefined) {
      seenScanSequence.current = data.scanSequence;
      setVisibleQr(data);
      return;
    }

    if (data.scanSequence && data.scanSequence !== previousSequence) {
      seenScanSequence.current = data.scanSequence;
      pendingQr.current = data;
      timers.current.forEach((timer) => window.clearTimeout(timer));
      setPhase("eating");
      phaseRef.current = "eating";
      timers.current = [
        window.setTimeout(() => {
          setPhase("thanks");
          phaseRef.current = "thanks";
        }, 3_450),
        window.setTimeout(() => {
          setVisibleQr(pendingQr.current);
          setPhase("ready");
          phaseRef.current = "ready";
        }, 6_300),
      ];
      return;
    }

    if (phaseRef.current === "ready") {
      setVisibleQr(data);
    }
  }, [data?.expiresAt, data?.scanSequence, data?.token]);

  if (error) {
    return (
      <main className="qr-display-shell qr-display-error">
        <p>Este enlace de pantalla ya no está disponible.</p>
      </main>
    );
  }

  if (isLoading || !visibleQr) {
    return <main className="qr-display-shell"><span className="qr-display-loader" aria-label="Cargando código QR" /></main>;
  }

  const qrValue = new URL(
    `${basePath}/attendance/${encodeURIComponent(visibleQr.token)}`,
    window.location.origin,
  ).toString();

  return (
    <main className="qr-display-shell" aria-live="polite">
      <div className={`qr-display-stage qr-display-stage--${phase}`}>
        <div className="qr-display-code" aria-label="Código QR de asistencia">
          <QRCodeSVG
            value={qrValue}
            size={560}
            level="H"
            includeMargin
            className="qr-display-svg"
          />
        </div>

        {phase === "eating" && (
          <div className="qr-display-eating" aria-label="Farbot está consumiendo el código QR">
            <div className="qr-paper" aria-hidden="true">
              <QRCodeSVG value={qrValue} size={220} level="H" includeMargin className="qr-paper-svg" />
              <span className="qr-paper-label">ASISTENCIA</span>
            </div>
            <div className="qr-paper-edge" aria-hidden="true" />
            <div className="qr-suction" aria-hidden="true" />
            <div className="qr-crumb qr-crumb--one" aria-hidden="true" />
            <div className="qr-crumb qr-crumb--two" aria-hidden="true" />
            <div className="qr-crumb qr-crumb--three" aria-hidden="true" />
            <div className="qr-display-robot-wrap">
              <FarbotMascot className="qr-display-robot" />
            </div>
          </div>
        )}

        {phase === "thanks" && (
          <div className="qr-display-thanks">
            <div className="qr-display-confetti" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </div>
            <FarbotMascot className="qr-display-thanks-robot" />
            <p className="qr-display-eyebrow">Farbot confirma tu registro</p>
            <h1>¡Gracias!</h1>
            <p>Tu asistencia quedó registrada.</p>
          </div>
        )}
      </div>
    </main>
  );
}