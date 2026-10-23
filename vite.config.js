import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// On localhost, answer POST /api/ask the same way the Vercel function does
// (api/ask.js), using GEMINI_API_KEY from .env.local -- a git-ignored file,
// so the key never ends up in the repo or in the app the browser downloads.
function localAiApi() {
  return {
    name: 'airgrip-local-ai-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      server.middlewares.use('/api/ask', async (req, res) => {
        const send = (status, body) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return send(405, { error: 'Use POST.' })
        let raw = ''
        for await (const chunk of req) raw += chunk
        let body = {}
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          return send(400, { error: 'Bad request.' })
        }
        const { askGemini } = await server.ssrLoadModule('/api/_lib/askGemini.js')
        const { status, body: out } = await askGemini(body, env)
        send(status, out)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    localAiApi(),
    // Installable app: manifest + a service worker that caches the app for
    // offline use and quietly updates itself after each new deploy.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'AirGrip',
        short_name: 'AirGrip',
        description: 'Fun hand and wrist exercises with progress you can see.',
        theme_color: '#1f2a6b',
        background_color: '#f3f5fa',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//], // the AI helper's server, never the cached app
      },
    }),
  ],
})
