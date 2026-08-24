import { useGetMyWeeklySchedule, useGetTodayAttendance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime } from "@/lib/utils";
import { QrCode, LogIn, LogOut, CheckCircle2, Clock, AlertCircle } from "lucide-react";

export default function EmployeePage() {
  const { data: attendance, isLoading, isError, refetch } = useGetTodayAttendance();
  const { data: weeklySchedule } = useGetMyWeeklySchedule();

  if (isLoading) {
    return <div className="mx-auto max-w-md"><Card><CardHeader><Skeleton className="h-6 w-1/3" /></CardHeader><CardContent><Skeleton className="h-32 w-full" /></CardContent></Card></div>;
  }
  if (isError || !attendance) {
    return <div className="mx-auto max-w-md py-12 text-center"><AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" /><h2 className="text-xl font-semibold">Error de conexión</h2><Button className="mt-5" variant="outline" onClick={() => void refetch()}>Intentar de nuevo</Button></div>;
  }

  const isCheckedIn = attendance.state === "checked_in";
  const isCheckedOut = attendance.state === "checked_out";
  const worked = `${Math.floor(attendance.workedMinutes / 60)}h ${attendance.workedMinutes % 60}m`;
  const todaySchedule = weeklySchedule?.days.find((day) => day.dayOfWeek === new Date().getDay());

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
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Clock className="h-5 w-5 text-primary" />Mi horario de hoy</CardTitle><CardDescription>Configurado por administración.</CardDescription></CardHeader>
        <CardContent>
          {!weeklySchedule ? <Skeleton className="h-16 w-full" /> : !todaySchedule?.startTime || !todaySchedule.endTime ? <p className="text-sm text-muted-foreground">Hoy es día libre.</p> : (
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">Jornada:</span> {todaySchedule.startTime} – {todaySchedule.endTime}</p>
              <p><span className="font-medium">Comida:</span> {todaySchedule.mealStart && todaySchedule.mealEnd ? `${todaySchedule.mealStart} – ${todaySchedule.mealEnd}` : "Sin intervalo configurado"}</p>
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
              El registro sólo se completa desde el enlace seguro del QR vigente. No hay registro manual.
            </div>
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