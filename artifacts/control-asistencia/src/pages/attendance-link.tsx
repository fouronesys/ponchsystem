import { useState } from "react";
import { CheckCircle2, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { getGetTodayAttendanceQueryKey, useGetTodayAttendance } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SelfieCapture } from "@/components/selfie-capture";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { getCurrentAttendanceLocation, locationPrecisionLabel, type AttendanceLocation } from "@/lib/location";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function signInUrl(token: string): string {
  const returnTo = `/attendance/${encodeURIComponent(token)}`;
  return `${basePath}/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}

export default function AttendanceLinkPage({ token }: { token: string }) {
  const { employee, ready } = useAuth();
  const { data: attendance, isLoading: attendanceLoading } = useGetTodayAttendance({
    query: {
      queryKey: getGetTodayAttendanceQueryKey(),
      enabled: ready && employee?.role === "employee",
    },
  });
  const [selfie, setSelfie] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<"check_in" | "check_out" | null>(null);
  const [error, setError] = useState("");
  const [location, setLocation] = useState<AttendanceLocation | null>(null);
  const [locating, setLocating] = useState(false);

  const submit = async () => {
    if (!selfie || pending) return;
    setPending(true);
    setLocating(true);
    setError("");
    try {
      const currentLocation = await getCurrentAttendanceLocation();
      setLocation(currentLocation);
      setLocating(false);
      const event = await apiFetch<{ type: "check_in" | "check_out" }>("/attendance/scan", {
        method: "POST",
        body: JSON.stringify({ token, selfie, location: currentLocation }),
      });
      setSuccess(event.type);
      setSelfie(null);
      setLocation(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar tu asistencia.");
    } finally {
      setLocating(false);
      setPending(false);
    }
  };

  if (!ready) {
    return <main className="grid min-h-screen place-items-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Cargando" /></main>;
  }

  if (!employee) {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,_#dce9f6,_transparent_45%),linear-gradient(135deg,_#f8fafc,_#eef4f9)] px-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <img src={`${basePath}/logo.svg`} alt="FarCheck RD" className="mx-auto mb-3 h-16 w-16" />
            <CardTitle>Confirma tu asistencia</CardTitle>
            <CardDescription>Inicia sesión para continuar con tu selfie y registrar tu entrada o salida.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => window.location.assign(signInUrl(token))}>
              <LogIn className="mr-2 h-4 w-4" />Iniciar sesión
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (employee.role !== "employee") {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <ShieldCheck className="mx-auto mb-2 h-10 w-10 text-primary" />
            <CardTitle>Acceso para personal</CardTitle>
            <CardDescription>Este enlace está destinado a registrar la asistencia de un empleado.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (success) {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,_#dce9f6,_transparent_45%),linear-gradient(135deg,_#f8fafc,_#eef4f9)] px-4">
        <Card className="w-full max-w-md text-center shadow-xl">
          <CardHeader>
            <CheckCircle2 className="mx-auto mb-2 h-14 w-14 text-success" />
            <CardTitle>¡Registro exitoso!</CardTitle>
            <CardDescription>Tu {success === "check_in" ? "entrada" : "salida"} quedó registrada con selfie en FarCheck RD.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const action = attendance?.state === "checked_in" ? "salida" : "entrada";

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,_#dce9f6,_transparent_45%),linear-gradient(135deg,_#f8fafc,_#eef4f9)] px-4 py-8">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="flex items-center gap-3">
            <img src={`${basePath}/logo.svg`} alt="" className="h-12 w-12" />
            <div>
              <p className="text-sm font-semibold text-primary">FarCheck RD</p>
              <CardTitle>Registrar {action}</CardTitle>
            </div>
          </div>
          <CardDescription>
            {attendanceLoading ? "Preparando tu registro…" : `Hola, ${employee.displayName}. Toma una selfie para confirmar tu ${action}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selfie ? (
            <SelfieCapture disabled={pending || attendanceLoading} onCaptured={setSelfie} />
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border bg-muted">
                <img src={selfie} alt="Selfie de evidencia" className="aspect-square w-full object-cover" />
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => void submit()} disabled={pending}>
                  {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {locating ? "Comprobando ubicación…" : pending ? "Registrando…" : `Confirmar ${action}`}
                </Button>
                <Button variant="outline" onClick={() => setSelfie(null)} disabled={pending}>Repetir</Button>
              </div>
              {location && !locating && <p className="text-center text-xs text-muted-foreground">{locationPrecisionLabel(location.accuracy)}</p>}
            </>
          )}
          {error && (
            <div className="space-y-1 text-sm text-destructive">
              <p>{error}</p>
              {error.includes("QR expiró") && (
                <p className="text-xs text-muted-foreground">
                  Vuelve a escanear el código QR que aparece en la pantalla de recepción.
                </p>
              )}
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">El QR se valida una sola vez para proteger tu registro.</p>
        </CardContent>
      </Card>
    </main>
  );
}