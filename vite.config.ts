import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // This allows the app to use process.env.API_KEY in the browser
    'process.env': {
      API_KEY: JSON.stringify(process.env.API_KEY),
      NEXT_PUBLIC_SUPABASE_URL: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    }
  }
});