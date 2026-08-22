import { useEffect, useRef, useState } from "react";
import {
  getGetQrDisplayStatusQueryKey,
  useGetQrDisplayStatus,
  type QrDisplayStatus,
} from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";

type DisplayPhase = "ready" | "eating" | "thanks";

function RobotMascot({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="50" y="68" width="140" height="116" rx="44" fill="#17324D" />
      <rect x="62" y="78" width="116" height="71" rx="30" fill="#2E6685" />
      <path d="M120 48V67M109 47H131" stroke="#17324D" strokeWidth="12" strokeLinecap="round" />
      <circle cx="91" cy="111" r="16" fill="#DFF8FF" />
      <circle cx="149" cy="111" r="16" fill="#DFF8FF" />
      <circle cx="94" cy="113" r="7" fill="#17324D" />
      <circle cx="146" cy="113" r="7" fill="#17324D" />
      <path d="M91 143C109 158 132 158 150 143" stroke="#DFF8FF" strokeWidth="8" strokeLinecap="round" />
      <rect x="82" y="176" width="76" height="28" rx="14" fill="#F5B942" />
      <path d="M68 176L39 201M172 176L201 201" stroke="#17324D" strokeWidth="18" strokeLinecap="round" />
      <path d="M73 196L48 214M167 196L192 214" stroke="#2E6685" strokeWidth="18" strokeLinecap="round" />
      <circle cx="120" cy="31" r="12" fill="#F5B942" />
    </svg>
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
    document.title = "Código de asistencia";
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
        }, 1_150),
        window.setTimeout(() => {
          setVisibleQr(pendingQr.current);
          setPhase("ready");
          phaseRef.current = "ready";
        }, 4_200),
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

  return (
    <main className="qr-display-shell" aria-live="polite">
      <div className={`qr-display-stage qr-display-stage--${phase}`}>
        <div className="qr-display-code" aria-label="Código QR de asistencia">
          <QRCodeSVG
            value={visibleQr.token}
            size={560}
            level="H"
            includeMargin
            className="qr-display-svg"
          />
        </div>

        {phase === "eating" && (
          <div className="qr-display-eating" aria-label="Registro confirmado">
            <RobotMascot className="qr-display-robot" />
          </div>
        )}

        {phase === "thanks" && (
          <div className="qr-display-thanks">
            <div className="qr-display-confetti" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </div>
            <RobotMascot className="qr-display-thanks-robot" />
            <p className="qr-display-eyebrow">Registro confirmado</p>
            <h1>¡Gracias!</h1>
            <p>Tu asistencia quedó registrada.</p>
          </div>
        )}
      </div>
    </main>
  );
}