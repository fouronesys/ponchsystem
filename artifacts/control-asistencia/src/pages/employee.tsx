import { useState } from "react";
import { useGetMyWeeklySchedule, useGetTodayAttendance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { SelfieCapture } from "@/components/selfie-capture";
import { getCurrentAttendanceLocation, locationPrecisionLabel, type AttendanceLocation } from "@/lib/location";
import { QrCode, LogIn, LogOut, CheckCircle2, Clock, AlertCircle, Camera, Loader2 } from "lucide-react";

export default function EmployeePage() {
  const { data: attendance, isLoading, isError, refetch } = useGetTodayAttendance();
  const { data: weeklySchedule } = useGetMyWeeklySchedule();
  const [manualSelfie, setManualSelfie] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [manualLocation, setManualLocation] = useState<AttendanceLocation | null>(null);
  const [isLocatingManual, setIsLocatingManual] = useState(false);

  if (isLoading) {
    return <div className="mx-auto max-w-md"><Card><CardHeader><Skeleton className="h-6 w-1/3" /></CardHeader><CardContent><Skeleton className="h-32 w-full" /></CardContent></Card></div>;
  }
  if (isError || !attendance) {
    return <div className="mx-auto max-w-md py-12 text-center"><AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" /><h2 className="text-xl font-semibold">Error de conexión</h2><Button className="mt-5" variant="outline" onClick={() => void refetch()}>Intentar de nuevo</Button></div>;
  }

  const isCheckedIn = attendance.state === "checked_in";
  const isCheckedOut = attendance.state === "checked_out";
  const worked = `${Math.floor(attendance.workedMinutes / 60)}h ${attendance.workedMinutes % 60}m`;
  const todaySchedule = weeklySchedule?.days.find((day) => day.dayOfWeek === bogotaDayOfWeek());
  const submitManualAttendance = async () => {
    if (!manualSelfie) return;
    setManualError(null);
    setIsLocatingManual(true);
    try {
      const location = await getCurrentAttendanceLocation();
      setManualLocation(location);
      setIsLocatingManual(false);
      setIsSubmittingManual(true);
      await apiFetch("/attendance/manual", {
        method: "POST",
        body: JSON.stringify({ selfie: manualSelfie, location }),
      });
      setManualSelfie(null);
      setManualLocation(null);
      await refetch();
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "No pudimos registrar la asistencia.");
    } finally {
      setIsLocatingManual(false);
      setIsSubmittingManual(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="border-t-4 border-t-primary">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div><CardTitle className="text-2xl">{attendance.employeeName}</CardTitle><CardDescription>ID: {attendance.employeeId}</CardDescription></div>
            <StatusBadge state={attendance.state} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <TimeBox icon={<LogIn className="h-3.5 w-3.5" />} label="Entrada" value={formatTime(attendance.checkIn)} />
            <TimeBox icon={<LogOut className="h-3.5 w-3.5" />} label="Salida" value={formatTime(attendance.checkOut)} />
          </div>
          {(isCheckedIn || isCheckedOut) && <div className="flex items-center gap-3 rounded-lg border bg-card p-3"><Clock className="h-5 w-5 text-primary" /><div><p className="text-xs font-medium uppercase text-muted-foreground">Tiempo registrado</p><p className="font-semibold">{worked}</p></div></div>}
            {(attendance.checkInTimingStatus || attendance.checkOutTimingStatus) && (
              <div className="space-y-2 rounded-lg border bg-secondary/30 p-3 text-sm">
                {attendance.checkInTimingStatus && <TimingNotice label="Entrada" status={attendance.checkInTimingStatus} />}
                {attendance.checkOutTimingStatus && <TimingNotice label="Salida" status={attendance.checkOutTimingStatus} />}
              </div>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Clock className="h-5 w-5 text-primary" />Mi horario de hoy</CardTitle><CardDescription>Configurado por administración.</CardDescription></CardHeader>
        <CardContent>
          {!weeklySchedule ? <Skeleton className="h-16 w-full" /> : !todaySchedule?.startTime || !todaySchedule.endTime ? <p className="text-sm text-muted-foreground">Hoy es día libre.</p> : (
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">Jornada:</span> {formatScheduleTime(todaySchedule.startTime)} – {formatScheduleTime(todaySchedule.endTime)}</p>
              <p><span className="font-medium">Comida:</span> {todaySchedule.mealStart && todaySchedule.mealEnd ? `${formatScheduleTime(todaySchedule.mealStart)} – ${formatScheduleTime(todaySchedule.mealEnd)}` : "Sin intervalo configurado"}</p>
            </div>
          )}
          {weeklySchedule && (
            <div className="mt-5 space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Semana completa</p>
              {weeklySchedule.days.map((day) => (
                <div key={day.dayOfWeek} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{DAY_NAMES[day.dayOfWeek]}</span>
                  {!day.startTime || !day.endTime ? <Badge variant="secondary">Día libre</Badge> : <span className="text-muted-foreground">{formatScheduleTime(day.startTime)} – {formatScheduleTime(day.endTime)}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!isCheckedOut && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><QrCode className="h-5 w-5 text-primary" />Registrar {isCheckedIn ? "salida" : "entrada"}</CardTitle>
            <CardDescription>Escanea el QR de recepción con la cámara de tu teléfono. El enlace te traerá aquí para iniciar sesión, tomar tu selfie y confirmar el registro.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
               El QR sigue siendo el método recomendado. Si no está disponible, puedes registrar tu asistencia desde este dispositivo. La selfie es obligatoria y el registro sólo puede hacerlo tu propia cuenta.
            </div>
             {!manualSelfie ? (
               <SelfieCapture disabled={isSubmittingManual} onCaptured={setManualSelfie} />
             ) : (
               <div className="space-y-3">
                 <img src={manualSelfie} alt="Vista previa de selfie" className="mx-auto aspect-square w-48 rounded-xl object-cover" />
                  <Button className="w-full" onClick={() => void submitManualAttendance()} disabled={isSubmittingManual || isLocatingManual}>
                    {isSubmittingManual || isLocatingManual ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                    {isLocatingManual ? "Comprobando ubicación…" : isSubmittingManual ? "Registrando..." : `Confirmar ${isCheckedIn ? "salida" : "entrada"}`}
                 </Button>
                 <Button variant="outline" className="w-full" onClick={() => setManualSelfie(null)} disabled={isSubmittingManual}>Tomar otra selfie</Button>
                  {manualLocation && !isLocatingManual && <p className="text-center text-xs text-muted-foreground">{locationPrecisionLabel(manualLocation.accuracy)}</p>}
               </div>
             )}
             {manualError && <p className="text-sm text-destructive">{manualError}</p>}
          </CardContent>
        </Card>
      )}
      {isCheckedOut && <div className="flex flex-col items-center rounded-xl border border-success/20 bg-success/10 p-6 text-center"><CheckCircle2 className="mb-3 h-10 w-10 text-success" /><h3 className="font-semibold">Jornada completada</h3><p className="mt-1 text-sm text-muted-foreground">Tu salida y evidencia se registraron correctamente.</p></div>}
    </div>
  );
}

function TimeBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-lg bg-secondary/50 p-4"><div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{icon}{label}</div><div className="text-xl font-semibold">{value}</div></div>;
}

function StatusBadge({ state }: { state: "out" | "checked_in" | "checked_out" }) {
  if (state === "checked_in") return <Badge variant="success" className="px-3 py-1">En turno</Badge>;
  if (state === "checked_out") return <Badge variant="secondary" className="px-3 py-1">Finalizado</Badge>;
  return <Badge variant="warning" className="px-3 py-1">Ausente</Badge>;
}

function TimingNotice({ label, status }: { label: string; status: string }) {
  const labels: Record<string, string> = {
    on_time: "a tiempo",
    early: "temprana",
    late: "tardía",
    outside_shift: "fuera de jornada",
    day_off: "en día libre",
  };
  return <p><span className="font-medium">{label}:</span> {labels[status] ?? status}. Este registro no se bloqueó.</p>;
}

function bogotaDayOfWeek(): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
  }).format(new Date());
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[weekday] ?? 0;
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function formatScheduleTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours < 12 ? "a. m." : "p. m.";
  const displayHours = hours % 12 || 12;
  return `${value} (${displayHours}:${String(minutes).padStart(2, "0")} ${suffix})`;
}