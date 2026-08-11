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
      /* `prompt`, no `autoUpdate`.

         El problema de origen sigue siendo el mismo: la app instalada en el
         teléfono se queda con el paquete viejo y una función nueva "no
         aparece". Pero `autoUpdate` con `skipWaiting` lo resolvía a ciegas —el
         trabajador nuevo tomaba el control sin avisar y la pestaña abierta
         quedaba con código nuevo sirviendo una interfaz ya montada con el
         viejo—, y sobre todo lo resolvía en silencio: el usuario no tenía forma
         de saber que había una versión nueva ni que debía recargar.

         Ahora el trabajador nuevo ESPERA y `AvisoActualizacion` lo anuncia con
         un botón; al pulsarlo se le manda el `skipWaiting` y se recarga la
         página entera, así el código y lo que se ve pertenecen a la misma
         versión. `cleanupOutdatedCaches` sigue borrando los paquetes viejos en
         vez de acumularlos. */
      registerType: 'prompt',
      workbox: {
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

