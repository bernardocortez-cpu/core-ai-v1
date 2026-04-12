import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls through the Vite dev server so cookies (refresh token) work reliably on localhost.
    // This avoids cross-port cookie issues with SameSite on `localhost`.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          // Ensure cookies from the browser are forwarded to the backend.
          // (Defensive: some setups/proxies can drop the Cookie header.)
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.cookie) {
              proxyReq.setHeader('cookie', req.headers.cookie)
            }
          })
        },
      },
    },
  },
})
