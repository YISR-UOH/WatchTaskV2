# Vista del Mantenedor - Documentación

## Funcionalidad Implementada

Se ha implementado una vista completa para el rol de **mantenedor** que permite visualizar las órdenes de trabajo que tienen asignadas.

## Archivos Modificados/Creados

### 1. `/src/pages/MantenedorDashboard.jsx` (Nuevo)

- **Propósito**: Dashboard principal para usuarios con rol "mantenedor"
- **Funcionalidades**:
  - Muestra todas las órdenes asignadas al mantenedor autenticado
  - Tabla con detalles de cada orden (código, descripción, especialidad, estado, fecha, ubicación)
  - Resumen visual por estado de las órdenes (Pendiente, En Proceso, Completado, Cancelado)
  - Actualización automática cuando hay cambios en las órdenes (sincronización P2P)
  - Botón de actualización manual

### 2. `/src/App.jsx` (Modificado)

- **Cambios**:
  - Agregada importación de `MantenedorDashboard`
  - Nueva ruta `/mantenedor` protegida para rol "mantenedor"
  - Redirección automática en `DefaultRedirect()` para usuarios mantenedor

### 3. `/src/utils/APIdb.js` (Modificado)

- **Nueva función**: `fetchOrdersByAssignedUser(userCode)`
  - Filtra órdenes por el campo `info.asignado_a_code`
  - Más eficiente que cargar todas las órdenes y filtrar en el componente

## Estructura de Datos

Las órdenes se filtran usando el campo `asignado_a_code` dentro del objeto `info` de cada orden:

```javascript
order = {
  code: 123,
  info: {
    "Numero orden": "OT-123",
    asignado_a_code: 456, // Código del mantenedor asignado
    Descripcion: "Reparación equipos",
    Especialidad_id: 1, // 1=Eléctrico, 2=Mecánico
    Estado: "Pendiente", // Pendiente, En Proceso, Completado, Cancelado
    Fecha: "2025-09-29",
    Ubicacion: "Edificio A, Piso 2",
  },
};
```

## Flujo de Usuario

1. **Login**: El mantenedor ingresa sus credenciales
2. **Redirección**: El sistema automáticamente redirige a `/mantenedor`
3. **Carga de Datos**: Se cargan las órdenes asignadas usando `fetchOrdersByAssignedUser()`
4. **Vista de Órdenes**: Se muestra tabla con órdenes y resumen por estado
5. **Sincronización**: Los cambios se reflejan automáticamente via eventos P2P

## Características de UI/UX

- **Responsive**: Se adapta a diferentes tamaños de pantalla
- **Estados de Carga**: Spinner mientras cargan las órdenes
- **Indicadores Visuales**:
  - Badges de color para especialidades
  - Estados con colores distintivos
  - Contadores en el resumen
- **Interactividad**:
  - Botón de actualización manual
  - Hover effects en filas de la tabla

## Integración P2P

La vista está completamente integrada con el sistema P2P:

- Escucha eventos `orders:changed` para actualizaciones automáticas
- Compatible con la sincronización entre supervisores y mantenedores
- Respeta la jerarquía definida en `PeerContext.isHierarchyAllowed`

## Próximas Mejoras Sugeridas

1. **Filtros**: Agregar filtros por estado, especialidad, fecha
2. **Búsqueda**: Campo de búsqueda por código o descripción
3. **Detalles**: Vista expandida con más detalles de cada orden
4. **Acciones**: Permitir cambiar estado de las órdenes
5. **Notificaciones**: Alertas cuando se asignan nuevas órdenes

## Uso

Para acceder a la vista del mantenedor:

1. Crear un usuario con rol "mantenedor" desde el admin
2. Asignar órdenes al código del mantenedor (campo `asignado_a_code`)
3. El mantenedor puede hacer login y ver sus órdenes asignadas

La vista es completamente funcional y sigue las convenciones establecidas en el proyecto WatchTask.
