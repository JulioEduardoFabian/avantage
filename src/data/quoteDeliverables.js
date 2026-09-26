/**
 * Entregables que se ofrecen en una cotización, agrupados por tipo de trabajo.
 *
 * Es el bloque "Descripción del servicio y entregables incluidos" del
 * documento que el equipo ya usaba en papel: hasta ahora se tipeaba a mano en
 * un textarea cada vez, con el riesgo de que a una cotización le faltara una
 * línea o dijera algo distinto que a la anterior. Acá está el catálogo, y en
 * el formulario cada uno es un check que se marca o se desmarca.
 *
 * No se cotiza un solo servicio: una tesis completa (plan + informe final) y
 * un artículo científico comparten la mayoría de los entregables pero no el
 * producto central, así que cada paquete trae su propia lista y sus propios
 * textos por defecto (título, bajada, garantía, condiciones). Elegir el
 * paquete en el formulario cambia las dos cosas a la vez.
 *
 * `label` va en negrita en el documento y `description` a continuación, que es
 * exactamente cómo se imprime: "Reporte TURNITIN: Certificado oficial de…".
 */

/** Entregables que se venden igual en cualquier paquete. */
const PROPUESTAS = {
  key: 'propuestas',
  label: '03 Propuestas de tema',
  description: 'Acorde a las líneas de investigación de tu universidad.'
};

const CIERRE_COMUN = [
  {
    key: 'observaciones',
    label: 'Levantamiento de Observaciones',
    description: 'Corrección ilimitada de observaciones formuladas por el asesor y jurados.'
  },
  {
    key: 'turnitin',
    label: 'Reporte TURNITIN',
    description: 'Certificado oficial de verificación de antiplagio y bajo % de similitud.'
  },
  {
    key: 'diapositivas',
    label: 'Diapositivas Profesionales',
    description: 'Diseño de plantilla de alta calidad para la exposición final.'
  },
  {
    key: 'balotario',
    label: 'Balotario de Preguntas',
    description: 'Cuestionario de posibles preguntas del jurado.'
  },
  {
    key: 'asesoria',
    label: 'Asesoría Extraordinaria',
    description: 'Orientación personalizada continua en cada etapa del desarrollo.'
  },
  {
    key: 'simulacion',
    label: 'Simulación de Sustentación',
    description: 'Ensayo previo en vivo con simulación de jurado evaluador.'
  }
];

/** Paquetes cotizables, en el orden en que se ofrecen en el formulario. */
export const QUOTE_PACKAGES = [
  {
    key: 'tesis',
    label: 'Tesis',
    icon: '🎓',
    hint: 'Plan de tesis e informe final completo',
    deliverables: [
      PROPUESTAS,
      {
        key: 'plan',
        label: 'Plan de Tesis / Proyecto',
        description: 'Elaboración integral del anteproyecto con rigor metodológico.'
      },
      {
        key: 'informe',
        label: 'Informe Final / Tesis Completa',
        description: 'Desarrollo completo de capítulos, análisis de datos y resultados.'
      },
      ...CIERRE_COMUN
    ],
    defaults: {
      conceptTitle: 'DESARROLLO DE TESIS COMPLETA - SERVICIO INTEGRAL',
      serviceSubtitle: 'Acompañamiento, tutoría y correcciones continuas hasta la aprobación formal.',
      estimatedTime: '1 mes',
      statusLabel: 'Aprobada para gestión',
      warrantyText: 'El servicio asegura acompañamiento constante y revisiones adaptadas a las exigencias y rúbricas de la universidad hasta la aprobación formal de la tesis.',
      commercialTerms: [
        'Los entregables y avances se programarán según el cronograma acordado en el contrato de servicio.',
        'Esta cotización formaliza el alcance de la tesis terminada con las herramientas mencionadas, sin costos adicionales.',
        'Validez de la propuesta económica sujeta a confirmación antes de la fecha de vigencia indicada.'
      ].join('\n')
    }
  },
  {
    key: 'articulo',
    label: 'Artículo científico',
    icon: '📝',
    hint: 'Artículo de divulgación con rigor metodológico',
    deliverables: [
      PROPUESTAS,
      {
        key: 'articulo',
        label: 'Artículo de divulgación científico / Proyecto',
        description: 'Elaboración integral del Artículo con rigor metodológico.'
      },
      ...CIERRE_COMUN
    ],
    defaults: {
      conceptTitle: 'DESARROLLO DE ARTÍCULO CIENTÍFICO - SERVICIO INTEGRAL',
      serviceSubtitle: 'Acompañamiento, tutoría y correcciones continuas hasta la aprobación del artículo.',
      estimatedTime: '3 semanas',
      statusLabel: 'Aprobada para gestión',
      warrantyText: 'El servicio asegura acompañamiento constante y revisiones adaptadas a las exigencias y rúbricas de la universidad hasta la aprobación formal del artículo.',
      commercialTerms: [
        'Los entregables y avances se programarán según el cronograma acordado en el contrato de servicio.',
        'Esta cotización formaliza el alcance del artículo científico terminado con las herramientas mencionadas, sin costos adicionales.',
        'Validez de la propuesta económica sujeta a confirmación antes de la fecha de vigencia indicada.'
      ].join('\n')
    }
  }
];

/** Paquete con el que abre una cotización nueva. */
export const DEFAULT_QUOTE_PACKAGE = QUOTE_PACKAGES[0].key;

/** Paquete por clave; cae en el primero si llega una clave desconocida. */
export function findQuotePackage(key) {
  return QUOTE_PACKAGES.find((pkg) => pkg.key === key) || QUOTE_PACKAGES[0];
}

/** Una línea "Etiqueta: descripción" por entregable, como la lee el documento. */
export function deliverableLine(item) {
  return item.description ? `${item.label}: ${item.description}` : item.label;
}
