# Fix: Conexiones P2P persistentes entre Admin y Mantenedor

## Problema Identificado

El admin intentaba constantemente conectarse con el mantenedor, pero cuando detectaba que la jerarquía no estaba permitida (admin-mantenedor no es una conexión válida), cerraba la conexión y volvía a intentar conectarse, creando un bucle infinito.

## Reglas de Jerarquía P2P

El sistema permite solo estas conexiones:

- `admin ↔ supervisor`
- `mantenedor ↔ supervisor`

**NO permitido**: `admin ↔ mantenedor` (conexión directa)

## Solución Implementada

### 1. **Lista de Peers Bloqueados**

- Añadido `blockedPeersRef` para trackear peers que no pueden conectarse por reglas de jerarquía
- Cuando se detecta jerarquía no permitida, el peer se agrega a la lista de bloqueados

### 2. **Prevención de Reconexión**

- `connectToPeer()` ahora verifica si el peer está bloqueado antes de intentar conectar
- `scheduleConnect()` no programa conexiones para peers bloqueados

### 3. **Limpieza Inteligente**

- Los peers bloqueados se limpian cuando el usuario cambia de rol
- Función `clearBlockedPeers()` para limpiar manualmente todos los bloqueos
- Función `unblockPeer(remoteId)` para desbloquear un peer específico

### 4. **Panel de Debug Mejorado**

- Información sobre reglas de jerarquía
- Botón para desbloquear todos los peers manualmente
- Mejor logging del comportamiento de bloqueo

## Archivos Modificados

### `/src/p2p/PeerContext.jsx`

- ✅ Añadido `blockedPeersRef` para trackear peers bloqueados
- ✅ Modificado manejo de `hello` para bloquear conexiones no permitidas
- ✅ Actualizado `connectToPeer` y `scheduleConnect` para verificar bloqueos
- ✅ Limpieza de peers bloqueados en cambio de rol
- ✅ Funciones `unblockPeer` y `clearBlockedPeers`

### `/src/p2p/PeerDebugPanel.jsx`

- ✅ Sección de información sobre jerarquía P2P
- ✅ Botón para desbloquear todos los peers
- ✅ Mejores controles de debug

## Comportamiento Después del Fix

### Escenario: Admin + Mantenedor

1. **Admin detecta mantenedor** en la lista de peers
2. **Admin intenta conectar** al mantenedor
3. **Intercambio de hello** revela roles incompatibles
4. **Admin bloquea al mantenedor** y cierra conexión
5. **No más intentos de reconexión** - el bucle se rompe ✅

### Logs Esperados

```
[timestamp] hierarchy bloqueada remoteId roles: admin -> mantenedor
[timestamp] Conexión bloqueada por jerarquía remoteId
[timestamp] Conexión no programada - peer bloqueado remoteId
```

## Casos de Uso Válidos

### ✅ Admin ↔ Supervisor

- Admin puede conectarse con supervisores
- Comparten datos de usuarios y órdenes por especialidad

### ✅ Mantenedor ↔ Supervisor

- Supervisores pueden enviar órdenes específicas a mantenedores
- Mantenedores reciben solo sus órdenes asignadas

### ❌ Admin ↔ Mantenedor (Bloqueado)

- No hay conexión directa entre admin y mantenedores
- Los datos fluyen: Admin → Supervisor → Mantenedor

## Recuperación Manual

Si es necesario restablecer conexiones:

1. **Panel Debug** → Botón "Desbloquear todos"
2. **Cambio de rol** limpia automáticamente los bloqueos
3. **Reinicio de sesión** resetea el estado P2P

La solución es robusta y previene el comportamiento de bucle infinito mientras mantiene la flexibilidad para casos especiales.
