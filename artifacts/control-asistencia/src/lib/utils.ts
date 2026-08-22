import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(dateString: string | null) {
  if (!dateString) return "--:--"
  return format(parseISO(dateString), "HH:mm")
}

export function formatDateTime(dateString: string | null) {
  if (!dateString) return "-"
  return format(parseISO(dateString), "dd MMM yyyy, HH:mm", { locale: es })
}
