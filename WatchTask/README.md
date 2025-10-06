# WatchTask

Aplicación web para la gestión colaborativa de órdenes de mantenimiento. Está construida con React + Vite, usa IndexedDB (Dexie) para persistencia local y se sincroniza mediante WebRTC/Firebase.

## Scripts disponibles

```bash
npm install
npm run dev      # Inicia Vite en modo desarrollo (usa --host por defecto)
npm run build    # Genera la build de producción
npm run preview  # Sirve la build generada
npm run lint     # Ejecuta ESLint
npm run deploy   # Publica dist/ en GitHub Pages
```

## Progressive Web App (PWA)

WatchTask se distribuye como PWA con soporte offline gracias a `vite-plugin-pwa`.

- **Registro automático**: el Service Worker se instala y actualiza en segundo plano.
- **Recursos en caché**: las vistas, estilos y fuentes quedan disponibles para trabajar sin conexión tras la primera visita.
- **Indicadores**: cuando la app queda lista para uso offline se registra en la consola del navegador (`WatchTask está listo para funcionar sin conexión`).
- **IndexedDB persistente**: la aplicación solicita `StorageManager.persist()` para evitar que el navegador purgue los datos cuando el dispositivo se quede sin espacio.

### Recomendaciones para pruebas offline

1. Ejecuta `npm run build` y `npm run preview` para probar el comportamiento real del Service Worker.
2. Abre la aplicación, espera a que cargue completamente y verifica en DevTools > Application > Service Workers que esté activo.
3. Activa el modo "Offline" en DevTools para validar la navegación sin conexión.

### Consideraciones sobre IndexedDB

- WatchTask solicita automáticamente almacenamiento persistente (`navigator.storage.persist`).
- En navegadores que no lo soportan, la app sigue funcionando, pero el navegador podría eliminar los datos si necesita liberar espacio.
- Puedes verificar el estado en DevTools > Application > Storage > Persistence.
- La consola del navegador reporta el resultado (`granted`, `denied`, `persist-unsupported`, etc.) para facilitar diagnósticos.

## Configuración importante

- `base` está fijado a `/WatchTaskV2/` para servir la app en GitHub Pages.
- Variables de entorno (`.env`) definen credenciales de Firebase y el usuario administrador inicial.
- Los assets PWA se ubican en `public/` y el manifest se genera automáticamente durante la build.
