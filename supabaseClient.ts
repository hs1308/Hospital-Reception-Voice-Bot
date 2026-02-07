
import { createClient } from '@supabase/supabase-js';

const getEnv = (key: string): string => {
  // Try Vite-style import.meta.env first
  const metaEnv = (import.meta as any).env;
  if (metaEnv && metaEnv[key]) return metaEnv[key];

  // Fallback to Node-style process.env (common in Builder/CI)
  const procEnv = (typeof process !== 'undefined' ? process.env : {}) as any;
  if (procEnv && procEnv[key]) return procEnv[key];

  return '';
};

const getSupabaseConfig = () => {
  return {
    url: getEnv('VITE_SUPABASE_URL'),
    anonKey: getEnv('VITE_SUPABASE_ANON_KEY'),
  };
};

const createSupabaseClient = () => {
  const { url, anonKey } = getSupabaseConfig();
  
  if (!url || !anonKey) {
    return new Proxy({} as any, {
      get: (target, prop) => {
        if (prop === 'isProxy') return true;
        if (prop === 'from') {
           return () => ({
             select: () => ({ 
               eq: () => ({ 
                 maybeSingle: () => Promise.resolve({ data: null, error: new Error("Supabase VITE_ variables missing") }),
                 order: () => ({ 
                   maybeSingle: () => Promise.resolve({ data: null, error: new Error("Supabase VITE_ variables missing") }) 
                 })
               }) 
             }),
             insert: () => ({ 
               select: () => ({ 
                 single: () => Promise.resolve({ data: null, error: new Error("Supabase VITE_ variables missing") }) 
               }) 
             })
           });
        }
        return () => {};
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
