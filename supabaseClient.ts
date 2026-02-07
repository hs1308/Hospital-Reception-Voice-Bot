
import { createClient } from '@supabase/supabase-js';

const getSupabaseConfig = () => {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };
};

const createSupabaseClient = () => {
  const { url, anonKey } = getSupabaseConfig();
  
  if (!url || !anonKey) {
    // Return a proxy that throws a helpful error when any property is accessed.
    // This prevents the application from crashing on initial load.
    return new Proxy({} as any, {
      get: (target, prop) => {
        if (prop === 'isProxy') return true;
        throw new Error(
          "Supabase configuration missing. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in your environment variables."
        );
      },
    });
  }
  
  try {
    return createClient(url, anonKey);
  } catch (e: any) {
    return new Proxy({} as any, {
      get: () => {
        throw new Error(`Failed to initialize Supabase: ${e.message}`);
      }
    });
  }
};

export const supabase = createSupabaseClient();

export const isSupabaseConfigured = () => {
  const { url, anonKey } = getSupabaseConfig();
  return !!url && !!anonKey;
};
