import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies the engine so the console and the API share one origin,
// as they do behind vlab-proxy (nginx) in production. changeOrigin stays false: the
// engine's CSRF check compares the browser's Origin with the Host it receives, so the
// Host must stay the console's own (nginx: proxy_set_header Host $host).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const engine = env.VLAB_ENGINE_URL || 'https://localhost:5000';
  // the engine serves VNC websockets on its port + 1 (pegaprox app.py); nginx routes the same path
  const vnc = env.VLAB_ENGINE_VNC_URL || 'https://localhost:5001';
  return {
    plugins: [react()],
    build: { target: 'es2022' },
    define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
    server: {
      port: 5173,
      proxy: {
        '^/api/clusters/[^/]+/vms/.+/vncwebsocket': { target: vnc, changeOrigin: false, secure: false, ws: true },
        '/api': { target: engine, changeOrigin: false, secure: false },
        '/ws': { target: engine, changeOrigin: false, secure: false, ws: true },
      },
    },
  };
});
