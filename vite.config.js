import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      /* Sin esto, el teléfono se queda con la versión vieja guardada por el
         Service Worker: la app instalada en la pantalla de inicio sigue
         sirviendo el paquete anterior hasta que se cierran TODAS sus
         ventanas, y por eso una función nueva "no aparece" en el celular
         aunque ya esté desplegada.
           · skipWaiting        — la versión nueva toma el control enseguida.
           · clientsClaim       — y se aplica a la pestaña ya abierta.
           · cleanupOutdatedCaches — borra los paquetes viejos en vez de
             acumularlos. */
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true
      },
      manifest: {
        name: 'MM Capital Dashboard',
        short_name: 'MM Capital',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})

