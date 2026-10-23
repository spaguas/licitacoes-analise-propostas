import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, /api é repassado para a API (porta 3001), então não há problema de CORS.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': process.env.VITE_API_URL || 'http://localhost:3001' } },
});
