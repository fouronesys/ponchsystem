import { useEffect, useState } from "react";
import {
  useRotateQrToken,
  useGetAttendanceSummary,
  useListAttendanceEvents,
  getGetAttendanceSummaryQueryKey,
  getListAttendanceEventsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime, formatDateTime } from "@/lib/utils";
import { Users, UserCheck, Clock, UserMinus, RotateCw, Link2, Copy, ExternalLink, ShieldOff, LogIn, LogOut, MonitorSmartphone } from "lucide-react";
import { Camera, UserPlus, UserRound, UserRoundX } from "lucide-react";
import { apiFetch, imageToDataUrl } from "@/lib/api";
import type { WeeklySchedule, WeeklyScheduleDay } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [displayUrl, setDisplayUrl] = useState("");
  const [displayExpiresAt, setDisplayExpiresAt] = useState("");
  const [displayBusy, setDisplayBusy] = useState(false);
  const [displayError, setDisplayError] = useState("");
  
  // Dashboard data queries
  const { data: summary, isLoading: isLoadingSummary } = useGetAttendanceSummary();
  const { data: events, isLoading: isLoadingEvents } = useListAttendanceEvents();
  
  const rotateToken = useRotateQrToken();

  const copyDisplayUrl = async (url: string) => {
    if (!navigator.clipboard) throw new Error("No fue posible acceder al portapapeles.");
    await navigator.clipboard.writeText(url);
  };

  const createDisplayLink = async () => {
    setDisplayBusy(true);
    setDisplayError("");
    try {
      const link = await apiFetch<{ accessToken: string; expiresAt: string }>("/admin/qr/display-link", {
        method: "POST",
      });
      const url = new URL(`${basePath}/qr-display/${link.accessToken}`, window.location.origin).toString();
      setDisplayUrl(url);
      setDisplayExpiresAt(link.expiresAt);
      await copyDisplayUrl(url);
    } catch (reason) {
      setDisplayError(reason instanceof Error ? reason.message : "No pudimos crear el enlace de pantalla.");
    } finally {
      setDisplayBusy(false);
    }
  };

  const revokeDisplayLink = async () => {
    setDisplayBusy(true);
    setDisplayError("");
    try {
      await apiFetch<void>("/admin/qr/display-link", { method: "DELETE" });
      setDisplayUrl("");
      setDisplayExpiresAt("");
    } catch (reason) {
      setDisplayError(reason instanceof Error ? reason.message : "No pudimos revocar el enlace.");
    } finally {
      setDisplayBusy(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Top metrics row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard 
          title="Esperados" 
          value={summary?.expected} 
          icon={<Users className="w-4 h-4 text-muted-foreground" />} 
          loading={isLoadingSummary} 
        />
        <MetricCard 
          title="Presentes" 
          value={summary?.present} 
          icon={<UserCheck className="w-4 h-4 text-success" />} 
          loading={isLoadingSummary} 
          trend={summary && summary.expected > 0 ? `${Math.round((summary.present / summary.expected) * 100)}%` : undefined}
        />
        <MetricCard 
          title="Retardos" 
          value={summary?.late} 
          icon={<Clock className="w-4 h-4 text-warning" />} 
          loading={isLoadingSummary} 
        />
        <MetricCard 
          title="Completados" 
          value={summary?.checkedOut} 
          icon={<UserMinus className="w-4 h-4 text-muted-foreground" />} 
          loading={isLoadingSummary} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* QR display controls */}
        <Card className="lg:col-span-1 shadow-md border-t-4 border-t-primary h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Link2 className="w-5 h-5 text-primary" />
              Pantalla QR
            </CardTitle>
            <CardDescription>
              Abre el código rotativo en una terminal dedicada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Button className="w-full" onClick={() => void createDisplayLink()} disabled={displayBusy}>
              <Copy className="mr-2 h-4 w-4" />
              {displayBusy ? "Preparando enlace…" : "Crear y copiar enlace"}
            </Button>
            {displayUrl && (
              <div className="space-y-3 rounded-xl border bg-secondary/30 p-3">
                <Input value={displayUrl} readOnly aria-label="Enlace de la pantalla QR" onFocus={(event) => event.currentTarget.select()} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copyDisplayUrl(displayUrl)}>
                    <Copy className="mr-2 h-3.5 w-3.5" />Copiar
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={displayUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />Abrir
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Vence {formatDateTime(displayExpiresAt)}. Crear otro enlace revoca este.</p>
              </div>
            )}
            <Button variant="outline" className="w-full" onClick={() => rotateToken.mutate()} disabled={rotateToken.isPending}>
              <RotateCw className={`mr-2 h-4 w-4 ${rotateToken.isPending ? 'animate-spin' : ''}`} />
              Rotar QR manualmente
            </Button>
            {displayUrl && (
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => void revokeDisplayLink()} disabled={displayBusy}>
                <ShieldOff className="mr-2 h-4 w-4" />Revocar enlace de pantalla
              </Button>
            )}
            {displayError && <p className="text-sm text-destructive">{displayError}</p>}
          </CardContent>
        </Card>

        {/* Activity Log */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-lg">Bitácora de Eventos</CardTitle>
                <CardDescription>Registro en tiempo real</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: getListAttendanceEventsQueryKey() })}>
                <RotateCw className="w-4 h-4 mr-2" /> Refrescar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingEvents ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !events || events.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg bg-secondary/20">
                <Clock className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>No hay eventos registrados hoy</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Hora</TableHead>
                    <TableHead className="hidden sm:table-cell">Dispositivo</TableHead>
                    <TableHead>Evidencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{event.employeeName}</span>
                          <span className="text-xs text-muted-foreground font-mono">ID: {event.employeeId}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={event.type === 'check_in' ? "success" : "secondary"} className="gap-1 px-2 py-0.5">
                          {event.type === 'check_in' ? <LogIn className="w-3 h-3" /> : <LogOut className="w-3 h-3" />}
                          {event.type === 'check_in' ? 'Entrada' : 'Salida'}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatTime(event.timestamp)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                        <div className="flex items-center gap-1.5">
                          <MonitorSmartphone className="w-3.5 h-3.5" />
                          <span className="truncate max-w-[120px]">{event.deviceLabel || 'App'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {event.selfieUrl ? (
                          <a href={event.selfieUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                            <img src={event.selfieUrl} alt={`Selfie de ${event.employeeName}`} className="h-9 w-9 rounded-md object-cover" />
                            Ver
                          </a>
                        ) : <span className="text-xs text-muted-foreground">Sin evidencia</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

      </div>

      <EmployeeManager />
    </div>
  );
}

type EmployeeRecord = {
  id: string;
  username: string;
  displayName: string;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  active: boolean;
  role: "admin" | "employee";
  profilePhotoUrl: string | null;
  createdAt: string;
};

function EmployeeManager() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      setEmployees(await apiFetch<EmployeeRecord[]>("/admin/employees"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar los empleados.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setError("");
    try {
      const photo = form.get("profilePhoto");
      const profilePhoto = photo instanceof File && photo.size ? await imageToDataUrl(photo) : undefined;
      await apiFetch("/admin/employees", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
          displayName: form.get("displayName"),
          documentNumber: form.get("documentNumber"),
          email: form.get("email"),
          phone: form.get("phone"),
          jobTitle: form.get("jobTitle"),
          profilePhoto,
        }),
      });
      formElement.reset();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos crear el empleado.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (employee: EmployeeRecord) => {
    setError("");
    try {
      const updated = await apiFetch<EmployeeRecord>(`/admin/employees/${employee.id}`, {
        method: "PUT",
        body: JSON.stringify({ active: !employee.active }),
      });
      setEmployees((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos actualizar el empleado.");
    }
  };

  return (
    <section className="space-y-5">
      <div><h2 className="text-2xl font-semibold tracking-tight">Personal y credenciales</h2><p className="text-sm text-muted-foreground">Crea accesos locales y conserva la evidencia incluso cuando una cuenta se desactiva.</p></div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" />Nuevo empleado</CardTitle><CardDescription>La contraseña inicial debe tener al menos 8 caracteres.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 md:grid-cols-2">
            <Input required name="displayName" placeholder="Nombre completo" />
            <Input required name="username" placeholder="Usuario de acceso" autoComplete="off" />
            <Input required name="password" type="password" minLength={8} placeholder="Contraseña temporal (8+)" autoComplete="new-password" />
            <Input name="documentNumber" placeholder="Documento (opcional)" />
            <Input name="email" type="email" placeholder="Correo (opcional)" />
            <Input name="phone" placeholder="Teléfono (opcional)" />
            <Input name="jobTitle" placeholder="Cargo (opcional)" />
            <Input name="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp" />
            <div className="md:col-span-2"><Button disabled={saving}>{saving ? "Creando…" : "Crear empleado"}</Button></div>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Directorio de empleados</CardTitle><CardDescription>Desactivar una cuenta impide nuevos accesos sin eliminar su historial.</CardDescription></div><Button variant="outline" size="sm" onClick={() => void refresh()}><RotateCw className="mr-2 h-4 w-4" />Actualizar</Button></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : employees.length === 0 ? <p className="py-8 text-center text-muted-foreground">No hay empleados registrados.</p> : (
            <div className="space-y-3">
              {employees.map((employee) => <div key={employee.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                {employee.profilePhotoUrl ? <img src={employee.profilePhotoUrl} alt={`Foto de ${employee.displayName}`} className="h-11 w-11 rounded-full object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary"><UserRound className="h-5 w-5 text-muted-foreground" /></div>}
                <div className="min-w-[160px] flex-1"><p className="font-medium">{employee.displayName}</p><p className="text-xs text-muted-foreground">@{employee.username}{employee.jobTitle ? ` · ${employee.jobTitle}` : ""}</p></div>
                <Badge variant={employee.active ? "success" : "secondary"}>{employee.active ? "Activa" : "Desactivada"}</Badge>
                {employee.role !== "admin" && <Button size="sm" variant="outline" onClick={() => void toggleActive(employee)}>{employee.active ? <><UserRoundX className="mr-2 h-4 w-4" />Desactivar</> : <><UserRound className="mr-2 h-4 w-4" />Activar</>}</Button>}
              </div>)}
            </div>
          )}
        </CardContent>
      </Card>
      <ScheduleManager employees={employees} />
    </section>
  );
}

const WEEK_DAYS: Array<{ dayOfWeek: number; label: string }> = [
  { dayOfWeek: 1, label: "Lunes" },
  { dayOfWeek: 2, label: "Martes" },
  { dayOfWeek: 3, label: "Miércoles" },
  { dayOfWeek: 4, label: "Jueves" },
  { dayOfWeek: 5, label: "Viernes" },
  { dayOfWeek: 6, label: "Sábado" },
  { dayOfWeek: 0, label: "Domingo" },
];

function ScheduleManager({ employees }: { employees: EmployeeRecord[] }) {
  const [employeeId, setEmployeeId] = useState("");
  const [schedule, setSchedule] = useState<WeeklySchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!employeeId && employees[0]) {
      setEmployeeId(employees[0].id);
    }
    if (employeeId && !employees.some((employee) => employee.id === employeeId)) {
      setEmployeeId(employees[0]?.id ?? "");
    }
  }, [employeeId, employees]);

  useEffect(() => {
    if (!employeeId) {
      setSchedule(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void apiFetch<WeeklySchedule>(`/admin/employees/${employeeId}/schedule`)
      .then((nextSchedule) => {
        if (active) setSchedule(nextSchedule);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No pudimos cargar el horario.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [employeeId]);

  const updateDay = (dayOfWeek: number, changes: Partial<WeeklyScheduleDay>) => {
    setSchedule((current) => current ? {
      ...current,
      days: current.days.map((day) => day.dayOfWeek === dayOfWeek ? { ...day, ...changes } : day),
    } : current);
  };

  const save = async () => {
    if (!schedule || !employeeId) return;
    setSaving(true);
    setError("");
    try {
      const updated = await apiFetch<WeeklySchedule>(`/admin/employees/${employeeId}/schedule`, {
        method: "PUT",
        body: JSON.stringify({ days: schedule.days }),
      });
      setSchedule(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos guardar el horario.");
    } finally {
      setSaving(false);
    }
  };

  const selectedEmployee = employees.find((employee) => employee.id === employeeId);
  const daysByNumber = new Map(schedule?.days.map((day) => [day.dayOfWeek, day]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Horario semanal</CardTitle>
        <CardDescription>Configura la jornada y el intervalo de comida de cada empleado. Deja un día libre sin horas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {employees.length === 0 ? <p className="text-sm text-muted-foreground">Crea un empleado para asignarle un horario.</p> : (
          <>
            <label className="block max-w-md text-sm font-medium">
              Empleado
              <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2">
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName} (@{employee.username})</option>)}
              </select>
            </label>
            {selectedEmployee && <p className="text-sm text-muted-foreground">Horario de <span className="font-medium text-foreground">{selectedEmployee.displayName}</span>.</p>}
            {loading || !schedule ? <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div> : (
              <div className="space-y-3">
                {WEEK_DAYS.map(({ dayOfWeek, label }) => {
                  const day = daysByNumber.get(dayOfWeek)!;
                  const isWorking = Boolean(day.startTime && day.endTime);
                  const hasMeal = Boolean(day.mealStart && day.mealEnd);
                  return (
                    <div key={dayOfWeek} className="rounded-xl border p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="font-semibold">{label}</p>
                        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={isWorking} onChange={(event) => updateDay(dayOfWeek, event.target.checked ? { startTime: day.startTime ?? "08:00", endTime: day.endTime ?? "17:00" } : { startTime: null, endTime: null, mealStart: null, mealEnd: null })} />Laborable</label>
                      </div>
                      {isWorking ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          <label className="text-sm">Entrada<Input type="time" value={day.startTime ?? ""} onChange={(event) => updateDay(dayOfWeek, { startTime: event.target.value || null })} /></label>
                          <label className="text-sm">Salida<Input type="time" value={day.endTime ?? ""} onChange={(event) => updateDay(dayOfWeek, { endTime: event.target.value || null })} /></label>
                          <label className="flex items-end gap-2 pb-2 text-sm font-medium"><input type="checkbox" checked={hasMeal} onChange={(event) => updateDay(dayOfWeek, event.target.checked ? { mealStart: "12:00", mealEnd: "13:00" } : { mealStart: null, mealEnd: null })} />Tiene comida</label>
                          {hasMeal && <><label className="text-sm">Inicio comida<Input type="time" value={day.mealStart ?? ""} onChange={(event) => updateDay(dayOfWeek, { mealStart: event.target.value || null })} /></label><label className="text-sm">Fin comida<Input type="time" value={day.mealEnd ?? ""} onChange={(event) => updateDay(dayOfWeek, { mealEnd: event.target.value || null })} /></label></>}
                        </div>
                      ) : <p className="text-sm text-muted-foreground">Día libre.</p>}
                    </div>
                  );
                })}
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={() => void save()} disabled={!schedule || loading || saving}>{saving ? "Guardando…" : "Guardar horario semanal"}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCard({ 
  title, 
  value, 
  icon, 
  trend,
  loading 
}: { 
  title: string; 
  value?: number; 
  icon: React.ReactNode; 
  trend?: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-bold tracking-tight">{value !== undefined ? value : '-'}</div>
            {trend && <div className="text-xs font-medium text-muted-foreground ml-auto bg-secondary px-2 py-0.5 rounded-full">{trend}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
