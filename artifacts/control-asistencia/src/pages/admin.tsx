import { useEffect, useState } from "react";
import {
  useRotateQrToken,
  useGetAttendanceSummary,
  useListAttendanceEvents,
  exportAttendancePdf,
  exportAttendanceXml,
  applyWeeklyScheduleToEmployees,
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
import { Users, UserCheck, Clock, UserMinus, RotateCw, Link2, Copy, ExternalLink, ShieldOff, LogIn, LogOut, MonitorSmartphone, MapPin, Download, FileCode2, FileText } from "lucide-react";
import { Camera, Pencil, Save, UserPlus, UserRound, UserRoundX, X } from "lucide-react";
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
                    <TableHead>Hora / puntualidad</TableHead>
                    <TableHead className="hidden sm:table-cell">Dispositivo</TableHead>
                    <TableHead className="hidden md:table-cell">Ubicación</TableHead>
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
                         <div>{formatTime(event.timestamp)}</div>
                         <TimingBadge status={event.timingStatus} scheduledTime={event.scheduledTime} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                        <div className="flex items-center gap-1.5">
                          <MonitorSmartphone className="w-3.5 h-3.5" />
                          <span className="truncate max-w-[120px]">{event.deviceLabel || 'App'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-xs">
                        <LocationEvidence value={event.location} />
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

      <ReportExporter />
      <EmployeeManager />
    </div>
  );
}

function ReportExporter() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [downloading, setDownloading] = useState<"pdf" | "xml" | null>(null);
  const [error, setError] = useState("");

  const download = async (format: "pdf" | "xml") => {
    if (!startDate || !endDate || startDate > endDate) {
      setError("Selecciona un rango de fechas válido.");
      return;
    }
    setDownloading(format);
    setError("");
    try {
      const filename = `farcheck-rd-asistencia-${startDate}-${endDate}.${format}`;
      const blob = format === "pdf"
        ? await exportAttendancePdf({ start: startDate, end: endDate })
        : new Blob([await exportAttendanceXml({ start: startDate, end: endDate })], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos generar el reporte.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5 text-primary" />Reportes para nómina</CardTitle>
        <CardDescription>Exporta la asistencia del período con horas, ausencias y excepciones de puntualidad.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Desde<Input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} aria-label="Fecha inicial del reporte" className="mt-1" /></label>
          <label className="text-sm font-medium">Hasta<Input type="date" value={endDate} min={startDate || undefined} max={today} onChange={(event) => setEndDate(event.target.value)} aria-label="Fecha final del reporte" className="mt-1" /></label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => void download("pdf")} disabled={Boolean(downloading)}><FileText className="mr-2 h-4 w-4" />{downloading === "pdf" ? "Generando PDF…" : "Descargar PDF"}</Button>
          <Button variant="outline" onClick={() => void download("xml")} disabled={Boolean(downloading)}><FileCode2 className="mr-2 h-4 w-4" />{downloading === "xml" ? "Generando XML…" : "Descargar XML"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">El XML es el formato estructurado propio de FarCheck RD para importar o revisar en nómina.</p>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}

function TimingBadge({ status, scheduledTime }: { status: string; scheduledTime: string | null }) {
  const labels: Record<string, string> = {
    on_time: "A tiempo",
    early: "Temprano",
    late: "Tardío",
    outside_shift: "Fuera de jornada",
    day_off: "Día libre",
  };
  const variants: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
    on_time: "success",
    early: "warning",
    late: "warning",
    outside_shift: "destructive",
    day_off: "secondary",
  };
  return <Badge variant={variants[status] ?? "secondary"} className="mt-1 text-[10px]">{labels[status] ?? status}{scheduledTime ? ` · ${scheduledTime}` : ""}</Badge>;
}

function LocationEvidence({ value }: { value: string | null }) {
  if (!value) return <span>Sin ubicación</span>;
  try {
    const evidence = JSON.parse(value) as {
      latitude?: unknown;
      longitude?: unknown;
      accuracy?: unknown;
    };
    if (
      typeof evidence.latitude !== "number" ||
      typeof evidence.longitude !== "number" ||
      typeof evidence.accuracy !== "number"
    ) {
      return <span>Registrada</span>;
    }
    return (
      <div className="flex items-start gap-1.5">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {evidence.latitude.toFixed(5)}, {evidence.longitude.toFixed(5)}
          <br />
          ±{Math.max(1, Math.round(evidence.accuracy))} m
        </span>
      </div>
    );
  } catch {
    return <span>Registrada</span>;
  }
}

type EmployeeRecord = {
  id: string;
  username: string;
  displayName: string;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  active: boolean;
  employmentStartDate: string;
  employmentEndDate: string | null;
  role: "admin" | "employee";
  profilePhotoUrl: string | null;
  createdAt: string;
};

function EmployeeManager() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);

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
          department: form.get("department"),
           employmentStartDate: form.get("employmentStartDate"),
           employmentEndDate: form.get("employmentEndDate") || null,
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
  const updateDepartment = async (employee: EmployeeRecord, department: string) => {
    const normalized = department.trim();
    if (normalized === (employee.department ?? "")) return;
    try {
      const updated = await apiFetch<EmployeeRecord>(`/admin/employees/${employee.id}`, {
        method: "PUT",
        body: JSON.stringify({ department: normalized || null }),
      });
      setEmployees((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos actualizar el departamento.");
    }
  };
  const departments = [...new Set(employees.map((employee) => employee.department).filter(Boolean) as string[])].sort();
  const visibleEmployees = departmentFilter === "all"
    ? employees
    : employees.filter((employee) => employee.department === departmentFilter);
  const saveEditedEmployee = (updated: EmployeeRecord) => {
    setEmployees((current) => current.map((item) => item.id === updated.id ? updated : item));
    setEditingEmployee(null);
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
            <Input name="department" placeholder="Departamento (opcional)" list="department-options" />
            <datalist id="department-options">{departments.map((department) => <option key={department} value={department} />)}</datalist>
            <label className="text-sm font-medium">Inicio laboral<Input required name="employmentStartDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1" /></label>
            <label className="text-sm font-medium">Fin laboral (opcional)<Input name="employmentEndDate" type="date" className="mt-1" /></label>
            <Input name="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp" />
            <div className="md:col-span-2"><Button disabled={saving}>{saving ? "Creando…" : "Crear empleado"}</Button></div>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
      {editingEmployee && editingEmployee.role !== "admin" && (
        <EmployeeEditor
          employee={editingEmployee}
          departments={departments}
          onCancel={() => setEditingEmployee(null)}
          onSaved={saveEditedEmployee}
        />
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Directorio de empleados</CardTitle><CardDescription>Desactivar una cuenta impide nuevos accesos sin eliminar su historial.</CardDescription></div><Button variant="outline" size="sm" onClick={() => void refresh()}><RotateCw className="mr-2 h-4 w-4" />Actualizar</Button></CardHeader>
        <CardContent>
           {loading ? <Skeleton className="h-24 w-full" /> : employees.length === 0 ? <p className="py-8 text-center text-muted-foreground">No hay empleados registrados.</p> : (
            <div className="space-y-3">
               <label className="block max-w-sm text-sm font-medium">Filtrar por departamento
                 <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2">
                   <option value="all">Todos los departamentos</option>
                   {departments.map((department) => <option key={department} value={department}>{department}</option>)}
                 </select>
               </label>
                {visibleEmployees.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">No hay empleados en este departamento.</p> : visibleEmployees.map((employee) => <div key={employee.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                {employee.profilePhotoUrl ? <img src={employee.profilePhotoUrl} alt={`Foto de ${employee.displayName}`} className="h-11 w-11 rounded-full object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary"><UserRound className="h-5 w-5 text-muted-foreground" /></div>}
                 <div className="min-w-[160px] flex-1"><p className="font-medium">{employee.displayName}</p><p className="text-xs text-muted-foreground">@{employee.username}{employee.jobTitle ? ` · ${employee.jobTitle}` : ""}</p></div>
                 <Input defaultValue={employee.department ?? ""} placeholder="Departamento" list="department-options" className="w-44" onBlur={(event) => void updateDepartment(employee, event.target.value)} aria-label={`Departamento de ${employee.displayName}`} />
                <Badge variant={employee.active ? "success" : "secondary"}>{employee.active ? "Activa" : "Desactivada"}</Badge>
                 {employee.role !== "admin" && <>
                   <Button size="sm" variant="outline" onClick={() => setEditingEmployee(employee)}><Pencil className="mr-2 h-4 w-4" />Editar</Button>
                   <Button size="sm" variant="outline" onClick={() => void toggleActive(employee)}>{employee.active ? <><UserRoundX className="mr-2 h-4 w-4" />Desactivar</> : <><UserRound className="mr-2 h-4 w-4" />Activar</>}</Button>
                 </>}
              </div>)}
            </div>
          )}
        </CardContent>
      </Card>
      <ScheduleManager employees={employees} />
    </section>
  );
}

type EmployeeEditValues = {
  username: string;
  displayName: string;
  documentNumber: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  employmentStartDate: string;
  employmentEndDate: string;
  password: string;
  active: boolean;
  profilePhoto: File | null;
};

function EmployeeEditor({
  employee,
  departments,
  onCancel,
  onSaved,
}: {
  employee: EmployeeRecord;
  departments: string[];
  onCancel: () => void;
  onSaved: (employee: EmployeeRecord) => void;
}) {
  const [values, setValues] = useState<EmployeeEditValues>(() => ({
    username: employee.username,
    displayName: employee.displayName,
    documentNumber: employee.documentNumber ?? "",
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    jobTitle: employee.jobTitle ?? "",
    department: employee.department ?? "",
    employmentStartDate: employee.employmentStartDate,
    employmentEndDate: employee.employmentEndDate ?? "",
    password: "",
    active: employee.active,
    profilePhoto: null,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setValue = (field: keyof EmployeeEditValues, value: string | boolean | File | null) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        username: values.username,
        displayName: values.displayName,
        documentNumber: values.documentNumber.trim() || null,
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
        jobTitle: values.jobTitle.trim() || null,
        department: values.department.trim() || null,
        employmentStartDate: values.employmentStartDate,
        employmentEndDate: values.employmentEndDate || null,
        active: values.active,
      };
      if (values.password) body.password = values.password;
      if (values.profilePhoto) body.profilePhoto = await imageToDataUrl(values.profilePhoto);
      const updated = await apiFetch<EmployeeRecord>(`/admin/employees/${employee.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      onSaved(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos actualizar el empleado.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/30 shadow-md">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><Pencil className="h-5 w-5 text-primary" />Editar empleado</CardTitle>
          <CardDescription>Actualiza los datos de {employee.displayName}. El historial y el horario se conservan.</CardDescription>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving} aria-label="Cancelar edición"><X className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">Nombre completo<Input required maxLength={160} value={values.displayName} onChange={(event) => setValue("displayName", event.target.value)} className="mt-1" /></label>
          <label className="text-sm font-medium">Usuario de acceso<Input required maxLength={80} value={values.username} onChange={(event) => setValue("username", event.target.value)} autoComplete="off" className="mt-1" /></label>
          <label className="text-sm font-medium">Nueva contraseña (opcional)<Input type="password" minLength={8} maxLength={256} value={values.password} onChange={(event) => setValue("password", event.target.value)} autoComplete="new-password" placeholder="Dejar en blanco para conservarla" className="mt-1" /></label>
          <label className="text-sm font-medium">Documento<Input value={values.documentNumber} onChange={(event) => setValue("documentNumber", event.target.value)} className="mt-1" /></label>
          <label className="text-sm font-medium">Correo<Input type="email" value={values.email} onChange={(event) => setValue("email", event.target.value)} className="mt-1" /></label>
          <label className="text-sm font-medium">Teléfono<Input value={values.phone} onChange={(event) => setValue("phone", event.target.value)} className="mt-1" /></label>
          <label className="text-sm font-medium">Cargo<Input value={values.jobTitle} onChange={(event) => setValue("jobTitle", event.target.value)} className="mt-1" /></label>
          <label className="text-sm font-medium">Departamento<Input value={values.department} onChange={(event) => setValue("department", event.target.value)} list="department-options" className="mt-1" /></label>
          <label className="text-sm font-medium">Inicio laboral<Input required type="date" value={values.employmentStartDate} onChange={(event) => setValue("employmentStartDate", event.target.value)} className="mt-1" /></label>
          <label className="text-sm font-medium">Fin laboral (opcional)<Input type="date" value={values.employmentEndDate} onChange={(event) => setValue("employmentEndDate", event.target.value)} className="mt-1" /></label>
          <label className="text-sm font-medium">Nueva foto de perfil (opcional)
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setValue("profilePhoto", event.target.files?.[0] ?? null)} className="mt-1" />
          </label>
          <label className="flex items-center gap-2 self-end rounded-md border px-3 py-2 text-sm font-medium">
            <input type="checkbox" checked={values.active} onChange={(event) => setValue("active", event.target.checked)} className="h-4 w-4 accent-primary" />
            Cuenta activa
          </label>
          <div className="flex flex-col gap-2 sm:flex-row md:col-span-2">
            <Button type="submit" disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Guardando…" : "Guardar cambios"}</Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
          </div>
          {employee.profilePhotoUrl && <p className="text-xs text-muted-foreground md:col-span-2">La foto actual se conserva si no seleccionas una nueva.</p>}
          {error && <p className="text-sm text-destructive md:col-span-2" role="alert">{error}</p>}
        </form>
      </CardContent>
    </Card>
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
  const [targetEmployeeIds, setTargetEmployeeIds] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkConfirmationOpen, setBulkConfirmationOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");

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

  useEffect(() => {
    setTargetEmployeeIds((current) => current.filter((id) => (
      id !== employeeId && employees.some((employee) => employee.id === id && employee.active)
    )));
    setBulkConfirmationOpen(false);
  }, [employeeId, employees]);

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
  const departments = [...new Set(employees.map((employee) => employee.department).filter(Boolean) as string[])].sort();
  const targetableEmployees = employees.filter((employee) =>
    employee.id !== employeeId &&
    employee.active &&
    (departmentFilter === "all" || employee.department === departmentFilter),
  );
  const allTargetsSelected = targetableEmployees.length > 0 && targetEmployeeIds.length === targetableEmployees.length;
  const toggleTarget = (targetId: string) => {
    setTargetEmployeeIds((current) => current.includes(targetId)
      ? current.filter((id) => id !== targetId)
      : [...current, targetId]);
    setBulkConfirmationOpen(false);
    setBulkResult("");
  };
  const toggleAllTargets = () => {
    setTargetEmployeeIds(allTargetsSelected ? [] : targetableEmployees.map((employee) => employee.id));
    setBulkConfirmationOpen(false);
    setBulkResult("");
  };
  const applyToSelectedEmployees = async () => {
    if (!schedule || targetEmployeeIds.length === 0) return;
    setBulkSaving(true);
    setError("");
    setBulkResult("");
    try {
      const result = await applyWeeklyScheduleToEmployees({
        employeeIds: [employeeId, ...targetEmployeeIds],
        days: schedule.days,
      });
      setBulkResult(`Horario guardado en la plantilla y aplicado a ${targetEmployeeIds.length} ${targetEmployeeIds.length === 1 ? "empleado" : "empleados"}.`);
      setBulkConfirmationOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos aplicar el horario a la selección.");
      setBulkConfirmationOpen(false);
    } finally {
      setBulkSaving(false);
    }
  };
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
            <div className="grid gap-3 md:grid-cols-2">
            <label className="block max-w-md text-sm font-medium">
              Empleado
              <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2">
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName} (@{employee.username})</option>)}
              </select>
            </label>
            <label className="block max-w-md text-sm font-medium">Equipo por departamento
              <select value={departmentFilter} onChange={(event) => {
                setDepartmentFilter(event.target.value);
                setTargetEmployeeIds([]);
                setBulkConfirmationOpen(false);
              }} className="mt-1 w-full rounded-md border bg-background px-3 py-2">
                <option value="all">Todos los departamentos</option>
                {departments.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </label>
            </div>
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
                        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={isWorking} onChange={(event) => updateDay(dayOfWeek, event.target.checked ? { startTime: day.startTime ?? "08:00", endTime: day.endTime ?? "17:00" } : { startTime: null, endTime: null, mealStart: null, mealEnd: null })} />Día laborable</label>
                      </div>
                      {isWorking ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          <label className="text-sm">Entrada<Input type="time" value={day.startTime ?? ""} onChange={(event) => updateDay(dayOfWeek, { startTime: event.target.value || null })} /><span className="text-xs text-muted-foreground">Formato 24 h · 00:00 = 12:00 a. m.</span></label>
                          <label className="text-sm">Salida<Input type="time" value={day.endTime ?? ""} onChange={(event) => updateDay(dayOfWeek, { endTime: event.target.value || null })} /><span className="text-xs text-muted-foreground">Formato 24 h · 12:00 = 12:00 p. m.</span></label>
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
            {schedule && selectedEmployee && (
              <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/[0.02] p-4">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold"><Copy className="h-4 w-4 text-primary" />Aplicar este horario a varios empleados</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Usa el horario de <span className="font-medium text-foreground">{selectedEmployee.displayName}</span> como plantilla. Sólo se muestran cuentas activas.</p>
                </div>
                {targetableEmployees.length === 0 ? <p className="text-sm text-muted-foreground">No hay otros empleados activos para seleccionar.</p> : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{targetEmployeeIds.length} de {targetableEmployees.length} seleccionados</p>
                      <Button size="sm" variant="outline" onClick={toggleAllTargets}>{allTargetsSelected ? "Limpiar selección" : `Seleccionar todo${departmentFilter === "all" ? " el personal activo" : ` el departamento ${departmentFilter}`}`}</Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {targetableEmployees.map((employee) => {
                        const checked = targetEmployeeIds.includes(employee.id);
                        return <label key={employee.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors ${checked ? "border-primary bg-primary/5" : "hover:bg-secondary/40"}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleTarget(employee.id)} aria-label={`Seleccionar a ${employee.displayName}`} />
                          <span className="min-w-0"><span className="block truncate font-medium">{employee.displayName}</span><span className="block truncate text-xs text-muted-foreground">@{employee.username}</span></span>
                        </label>;
                      })}
                    </div>
                    {bulkConfirmationOpen ? (
                      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                        <p className="text-sm font-medium">Vas a guardar el horario de la plantilla y reemplazar el de {targetEmployeeIds.length} {targetEmployeeIds.length === 1 ? "empleado" : "empleados"}.</p>
                        <p className="mt-1 text-xs text-muted-foreground">Esta acción no cambia el historial de asistencia; sólo actualiza sus horarios futuros.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => void applyToSelectedEmployees()} disabled={bulkSaving}>{bulkSaving ? "Aplicando…" : "Confirmar y aplicar"}</Button>
                          <Button size="sm" variant="outline" onClick={() => setBulkConfirmationOpen(false)} disabled={bulkSaving}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="secondary" onClick={() => setBulkConfirmationOpen(true)} disabled={targetEmployeeIds.length === 0 || bulkSaving}>
                        <Copy className="mr-2 h-4 w-4" />Aplicar a {targetEmployeeIds.length || "varios"} empleados
                      </Button>
                    )}
                  </>
                )}
                {bulkResult && <p className="text-sm text-success" role="status">{bulkResult}</p>}
              </div>
            )}
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
