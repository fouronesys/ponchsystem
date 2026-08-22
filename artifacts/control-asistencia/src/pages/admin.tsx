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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { QRCodeSVG } from "qrcode.react";
import { formatTime, formatDateTime } from "@/lib/utils";
import { Users, UserCheck, Clock, UserMinus, RotateCw, QrCode, LogIn, LogOut, MonitorSmartphone, MapPin } from "lucide-react";

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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
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
