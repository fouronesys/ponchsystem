import { useState } from "react";
import { 
  useGetTodayAttendance, 
  useScanAttendanceQr, 
  getGetTodayAttendanceQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime } from "@/lib/utils";
import { QrCode, LogIn, LogOut, Loader2, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { QrScanner } from "@/components/qr-scanner";

export default function EmployeePage() {
  const [tokenInput, setTokenInput] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { 
    data: attendance, 
    isLoading: isLoadingAttendance,
    isError: isAttendanceError,
    refetch
  } = useGetTodayAttendance();
  
  const scanQr = useScanAttendanceQr({
    mutation: {
      onSuccess: (data) => {
        setTokenInput("");
        toast({
          title: "Registro exitoso",
          description: `Se ha registrado tu ${data.type === 'check_in' ? 'entrada' : 'salida'} correctamente.`,
        });
        queryClient.invalidateQueries({ queryKey: getGetTodayAttendanceQueryKey() });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error al registrar",
          description: "El código no es válido o ha expirado. Intenta de nuevo.",
        });
      }
    }
  });

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    scanQr.mutate({ data: { token: tokenInput } });
  };

  if (isLoadingAttendance) {
    return (
      <div className="max-w-md mx-auto space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-1/3 mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isAttendanceError || !attendance) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4 opacity-80" />
        <h2 className="text-xl font-semibold mb-2">Error de conexión</h2>
        <p className="text-muted-foreground mb-6">No pudimos cargar tu información de asistencia.</p>
        <Button onClick={() => refetch()} variant="outline">Intentar de nuevo</Button>
      </div>
    );
  }

  const isCheckedIn = attendance.state === 'checked_in';
  const isCheckedOut = attendance.state === 'checked_out';
  const hours = Math.floor(attendance.workedMinutes / 60);
  const minutes = attendance.workedMinutes % 60;
  const formattedWorkedTime = `${hours}h ${minutes}m`;

  return (
    <div className="max-w-md mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="border-t-4 border-t-primary">
        <CardHeader className="pb-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              <CardTitle className="text-2xl">{attendance.employeeName}</CardTitle>
              <CardDescription className="text-sm mt-1 flex items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-xs">ID: {attendance.employeeId}</Badge>
              </CardDescription>
            </div>
            <StatusBadge state={attendance.state} />
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-secondary/50 rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wider flex items-center gap-1.5">
                <LogIn className="w-3.5 h-3.5" />
                Entrada
              </div>
              <div className="text-xl font-semibold text-foreground">
                {formatTime(attendance.checkIn)}
              </div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wider flex items-center gap-1.5">
                <LogOut className="w-3.5 h-3.5" />
                Salida
              </div>
              <div className="text-xl font-semibold text-foreground">
                {formatTime(attendance.checkOut)}
              </div>
            </div>
          </div>

          {(isCheckedIn || isCheckedOut) && (
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-card text-card-foreground">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tiempo registrado</p>
                <p className="font-semibold">{formattedWorkedTime}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!isCheckedOut && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <QrCode className="w-5 h-5 text-primary" />
              Registrar {isCheckedIn ? 'Salida' : 'Entrada'}
            </CardTitle>
            <CardDescription>
              Escanea el código QR en recepción o ingresa el código manualmente.
            </CardDescription>
          </CardHeader>
          <CardContent>
              <div className="space-y-3">
                <QrScanner
                  disabled={scanQr.isPending}
                  onDetected={(token) => scanQr.mutate({ data: { token } })}
                />
                <form onSubmit={handleManualSubmit} className="flex gap-2">
                  <Input
                    placeholder="Ingresa el código manualmente..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    disabled={scanQr.isPending}
                    className="font-mono"
                  />
                  <Button type="submit" disabled={!tokenInput.trim() || scanQr.isPending}>
                    {scanQr.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Validar"}
                  </Button>
                </form>
              </div>
          </CardContent>
        </Card>
      )}

      {isCheckedOut && (
        <div className="text-center p-6 bg-success/10 rounded-xl border border-success/20 flex flex-col items-center">
          <CheckCircle2 className="w-10 h-10 text-success mb-3" />
          <h3 className="font-semibold text-success-foreground">Jornada completada</h3>
          <p className="text-sm text-success-foreground/80 mt-1">Has finalizado tu registro por el día de hoy.</p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: 'out' | 'checked_in' | 'checked_out' }) {
  switch (state) {
    case 'checked_in':
      return <Badge variant="success" className="px-3 py-1">En turno</Badge>;
    case 'checked_out':
      return <Badge variant="secondary" className="px-3 py-1">Finalizado</Badge>;
    case 'out':
    default:
      return <Badge variant="warning" className="px-3 py-1">Ausente</Badge>;
  }
}
