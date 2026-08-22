import { Link, useLocation } from "wouter";
import { User, BarChart, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { employee, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <img src={`${basePath}/logo.svg`} alt="" className="h-8 w-8 shrink-0" />
            <span className="font-semibold tracking-tight text-lg">FarCheck <span className="text-primary/70">RD</span></span>
          </div>

          <nav className="flex items-center gap-1">
            {employee?.role === "employee" && <Link href="/" className={cn(
              "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
              location === "/" 
                ? "bg-primary/10 text-primary" 
                : "text-muted-foreground hover:bg-muted"
            )}>
              <User className="w-4 h-4" />
              Empleado
            </Link>}
            {employee?.role === "admin" && <Link href="/admin" className={cn(
              "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
              location === "/admin" 
                ? "bg-primary/10 text-primary" 
                : "text-muted-foreground hover:bg-muted"
            )}>
              <BarChart className="w-4 h-4" />
              Consola
            </Link>}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void logout().then(() => window.location.assign(basePath || "/"))}
              aria-label="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
