import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Si faltan las variables, el cliente se crea con valores vacíos y la app
// muestra un aviso de configuración (ver ConfigGuard). Esto evita un crash
// en blanco cuando el sitio se publica sin secrets configurados.
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "public-anon-placeholder",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/** Bucket de Storage donde se guardan los materiales (PDFs, presentaciones). */
export const MATERIALS_BUCKET = "materials";
