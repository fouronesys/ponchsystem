import { FormEvent, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { Redirect, Route, Switch, useLocation, useRoute, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AdminPage from "@/pages/admin";
import EmployeePage from "@/pages/employee";
import AttendanceLinkPage from "@/pages/attendance-link";
import QrDisplayPage from "@/pages/qr-display";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/lib/auth-context";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function LandingPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,_#dce9f6,_transparent_45%),linear-gradient(135deg,_#f8fafc,_#eef4f9)] px-5">
      <section className="max-w-xl text-center">
        <img src={`${basePath}/logo.svg`} alt="FarCheck RD" className="mx-auto mb-6 h-20 w-20 drop-shadow-lg" />
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">FarCheck RD · Registro seguro</p>
        <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Cada jornada, validada en el momento.</h1>
        <p className="mx-auto mt-5 max-w-lg text-pretty text-lg leading-8 text-muted-foreground">
          FarCheck RD registra entrada y salida con sesión local, QR de un solo uso y selfie verificable.
        </p>
        <Button size="lg" className="mt-8" onClick={() => window.location.assign(`${basePath}/sign-in`)}>
          Iniciar sesión <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </section>
    </main>
  );
}

function SignInPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const employee = await login(username, password);
      const requestedReturnTo = new URLSearchParams(window.location.search).get("returnTo");
      const returnTo = requestedReturnTo?.startsWith(`${basePath}/attendance/`) ? requestedReturnTo : null;
      setLocation(employee.role === "admin" ? "/admin" : returnTo ?? "/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible iniciar sesión.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,_#dce9f6,_transparent_45%),linear-gradient(135deg,_#f8fafc,_#eef4f9)] px-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-8 shadow-xl">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <img src={`${basePath}/logo.svg`} alt="" className="h-10 w-10" />
            <div>
              <p className="text-sm font-semibold text-primary">FarCheck RD</p>
              <h1 className="text-2xl font-bold">Acceso de personal</h1>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Usa las credenciales asignadas por administración.</p>
        </div>
        <label className="block text-sm font-medium">
          Usuario
          <input required value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2" autoComplete="username" />
        </label>
        <label className="block text-sm font-medium">
          Contraseña
          <input required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2" type="password" autoComplete="current-password" />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ingresar
        </Button>
      </form>
    </div>
  );
}

function HomeRoute() {
  const { employee, ready } = useAuth();
  if (!ready) return null;
  if (!employee) return <LandingPage />;
  if (employee.role === "admin") return <Redirect to="/admin" />;
  return <Layout><EmployeePage /></Layout>;
}

function ProtectedAdmin() {
  const { employee, ready } = useAuth();
  if (!ready) return null;
  if (!employee) return <Redirect to="/sign-in" />;
  if (employee.role !== "admin") return <Redirect to="/" />;
  return <Layout><AdminPage /></Layout>;
}

function QrDisplayRoute() {
  const [, params] = useRoute("/qr-display/:accessToken");
  if (!params?.accessToken) return <NotFound />;
  return <QrDisplayPage accessToken={params.accessToken} />;
}

function Router() {
  const [location] = useLocation();
  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/admin" component={ProtectedAdmin} />
        <Route path="/attendance/:token">
          {(params) => <AttendanceLinkPage token={params.token} />}
        </Route>
        <Route path="/qr-display/:accessToken" component={QrDisplayRoute} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Router />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </AuthProvider>
    </WouterRouter>
  );
}

export default App;