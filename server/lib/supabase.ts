import { createClient } from "@supabase/supabase-js";
import ws from "ws";

/**
 * Crea un cliente Supabase autenticado con el JWT del usuario.
 * Configura `ws` como transporte de Realtime para Node.js < 22.
 */
export function createUserClient(authHeader: string) {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: authHeader } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      realtime: { transport: ws as any },
    },
  );
}
