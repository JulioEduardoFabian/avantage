import { reactive } from 'vue';

/**
 * Estado global de carga para la pantalla inicial (splash) y la barra de
 * progreso superior en cambios de ruta.
 */
export const loadingState = reactive({
  isBooting: true,
  isNavigating: false,
  bootMessage: 'Verificando sesión y preparando módulos…'
});

let navTimeout = null;

export function startRouteLoading() {
  clearTimeout(navTimeout);
  loadingState.isNavigating = true;
}

export function finishRouteLoading() {
  clearTimeout(navTimeout);
  navTimeout = setTimeout(() => {
    loadingState.isNavigating = false;
  }, 180);
}

export function finishAppBoot() {
  loadingState.isBooting = false;
}

