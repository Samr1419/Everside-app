import { createClient } from "@supabase/supabase-js";

// Vite: prefix env vars with VITE_ and read via import.meta.env
// Next.js: prefix with NEXT_PUBLIC_ and read via process.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
