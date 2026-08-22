import { useEffect, useState } from "react";
import { 
  useGetQrStatus, 
  useRotateQrToken,
  useGetAttendanceSummary,
  useListAttendanceEvents,
  getGetQrStatusQueryKey,
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
import { Progress } from "@/components/ui/progress";
import { QRCodeSVG } from "qrcode.react";
import { formatTime, formatDateTime } from "@/lib/utils";
import { Users, UserCheck, Clock, UserMinus, RotateCw, QrCode, LogIn, LogOut, MonitorSmartphone } from "lucide-react";
import { Camera, UserPlus, UserRound, UserRoundX } from "lucide-react";
import { apiFetch, imageToDataUrl } from "@/lib/api";

export default function AdminPage() {
  const queryClient = useQueryClient();
  
  // Dashboard data queries
  const { data: summary, isLoading: isLoadingSummary } = useGetAttendanceSummary();
  const { data: events, isLoading: isLoadingEvents } = useListAttendanceEvents();
  
  // QR status with aggressive polling since it's time-sensitive
  const { data: qrStatus, isLoading: isLoadingQr } = useGetQrStatus({
    query: {
      queryKey: getGetQrStatusQueryKey(),
      refetchInterval: 1000,
    }
  });
  
  const rotateToken = useRotateQrToken({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetQrStatusQueryKey() });
      }
    }
  });

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
        
        {/* Active QR Panel */}
        <Card className="lg:col-span-1 shadow-md border-t-4 border-t-primary h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <QrCode className="w-5 h-5 text-primary" />
              Token de Acceso
            </CardTitle>
            <CardDescription>
              Código rotativo para terminales
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoadingQr || !qrStatus ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-2 w-full" />
              </div>
            ) : (
              <>
                <div className="bg-secondary/30 rounded-xl p-6 text-center border border-secondary">
                  <div className="mx-auto mb-4 grid h-48 w-48 place-items-center rounded-lg bg-white p-3 shadow-sm">
                    <QRCodeSVG value={qrStatus.token} size={168} level="H" includeMargin={false} />
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">
                    Token protegido · uso único
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Expira en</span>
                    <span className="font-medium font-mono">{qrStatus.remainingSeconds}s</span>
                  </div>
                  <Progress value={(qrStatus.remainingSeconds / 90) * 100} className="h-1.5" />
                </div>

                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => rotateToken.mutate()}
                  disabled={rotateToken.isPending}
                >
                  <RotateCw className={`w-4 h-4 mr-2 ${rotateToken.isPending ? 'animate-spin' : ''}`} />
                  Rotar manualmente
                </Button>
              </>
            )}
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
    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
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
        <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" />Nuevo empleado</CardTitle><CardDescription>La contraseña inicial debe tener al menos 12 caracteres.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 md:grid-cols-2">
            <Input required name="displayName" placeholder="Nombre completo" />
            <Input required name="username" placeholder="Usuario de acceso" autoComplete="off" />
            <Input required name="password" type="password" minLength={12} placeholder="Contraseña temporal (12+)" autoComplete="new-password" />
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
    </section>
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
