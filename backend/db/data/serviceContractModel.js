/**
 * Modelo real de contrato de locación de servicios de Avantage Group, tal
 * como lo usa el área legal: 14 cláusulas, el cronograma de pagos, las cuentas
 * de abono y el cronograma de entregas.
 *
 * Esta es la versión vigente (confirmada por gerencia el 29/09/2026 sobre el
 * texto del contrato CTR-2026-0004). Reemplaza a la que cargó la migración
 * 20261013000000, que tenía otra redacción —la que hablaba de "el cliente" en
 * vez de usar los términos definidos «EL LOCADOR» y «EL ASESORADO»— y que
 * nunca fue la que el área legal quería emitir.
 *
 * La carga la migración 20261015000000_load_current_service_contract_model.js.
 *
 * Marcadores de DATO (se reemplazan por el valor del contrato; el que falta
 * queda como una línea para llenar a mano):
 *   {{empresa}} {{ruc}} {{domicilio_empresa}} {{representante}}
 *   {{cliente}} {{dni}} {{domicilio}} {{correo}} {{telefono}}
 *   {{servicio}} {{monto}} {{ciudad}} {{fecha}} {{universidad}} {{carrera}}
 *
 * Marcadores de BLOQUE (se expanden a una tabla entera):
 *   {{cuentas_bancarias}} {{cronograma_pagos}} {{cronograma_entregas}}
 *
 * Formato del cuerpo de una cláusula (ver backend/services/contractDocument.js):
 *   - los bloques se separan con una línea en blanco;
 *   - un bloque cuyas líneas llevan "|" se imprime como tabla (la primera
 *     fila es el encabezado);
 *   - un bloque cuyas líneas empiezan con "- " se imprime como viñetas;
 *   - el resto es un párrafo justificado.
 *
 * Dos cosas que NO se escriben acá:
 *
 * 1. El ordinal del título. El encabezado lo arma el documento con la POSICIÓN
 *    de la cláusula ("CLÁUSULA PRIMERA:"), así que mover o insertar una
 *    renumera todo solo. El Word del que viene este texto traía el ordinal
 *    escrito a mano —y ya con errores: tres cláusulas lo tenían duplicado
 *    ("CLÁUSULA DÉCIMA PRIMERA: CLÁUSULA DÉCIMO PRIMERA: …")—.
 *
 * 2. Los dos cronogramas. Van como marcador y no como tabla tecleada: las
 *    cuotas salen de las mismas filas que Finanzas cobra y las entregas de
 *    `contract_deliverables`, y las dos se editan en el formulario del
 *    contrato. Cuando se escribían a mano quedaban contratos emitidos con la
 *    tabla vacía, o con fechas que ya no coincidían con lo pactado porque
 *    alguien reprogramó un pago en Finanzas y nadie volvió a tocar la cláusula.
 */
export const SERVICE_CONTRACT_MODEL = {
  label: 'Contrato de locación de servicios (asesoría de tesis)',
  title: 'CONTRATO DE LOCACIÓN DE SERVICIOS',
  intro:
    'Conste por el presente documento, EL CONTRATO DE LOCACIÓN DE SERVICIOS, (en adelante «EL CONTRATO») que, ' +
    'en virtud al artículo 1764° y siguientes del Código Civil peruano, celebran de una parte:\n\n' +
    '{{empresa}}, empresa identificada con RUC No. {{ruc}}, con domicilio para estos efectos en ' +
    '{{domicilio_empresa}}, representada legalmente por {{representante}}; a quien en adelante se le ' +
    'denominará como «EL LOCADOR».\n\n' +
    'Y, de la otra parte:\n\n' +
    '{{cliente}}, identificado con DNI N°. {{dni}}, con domicilio para estos efectos en {{domicilio}}; ' +
    'a quien en adelante se le denominará como «EL ASESORADO».\n\n' +
    'EL LOCADOR y EL ASESORADO podrán ser denominados de manera conjunta como «LAS PARTES» o de manera ' +
    'individual como «LA PARTE». EL CONTRATO es celebrado por LAS PARTES en los términos y condiciones siguientes:',
  clauses: [
    {
      title: 'FINALIDAD DEL CONTRATO',
      body:
        'El objetivo principal del contrato es la elaboración y entrega de un trabajo o producto académico ' +
        'a favor del cliente, debiendo alinearse a los parámetros estipulados y a las normativas de la ' +
        '{{universidad}}, para la carrera o mención en {{carrera}}.'
    },
    {
      title: 'COMPROMISOS DEL LOCADOR',
      body:
        '- Elaboración de la tesis, con rigor metodológico, hasta su aprobación.\n' +
        '- Elaborar y entregar un contenido original con porcentajes mínimos de coincidencia o similitud académica (TURNITIN E IA).\n' +
        '- Corrección ilimitada de observaciones formuladas por el asesor y jurados.\n' +
        '- Brindar asesorías de preparación metodológica y temática durante el desarrollo del trabajo y para la sustentación.\n' +
        '- Entregar un balotario de preguntas probables de sustentación acorde.\n' +
        '- Plantilla de diapositivas en PowerPoint ajustada a la presentación.\n' +
        '- Guardar estricta reserva de los datos del cliente, salvo requerimiento legal o autorización explícita.\n' +
        '- Transferir la titularidad de los derechos de autoría intelectual al cliente.\n' +
        '- Utilizar el material académico únicamente para los fines pactados en el acuerdo.'
    },
    {
      title: 'COMPROMISOS DEL ASESORADO',
      body:
        '- Facilitar los datos necesarios para la aplicación de los instrumentos de investigación, así como la información sobre la muestra, población y lugar del estudio.\n' +
        '- Entregar al área académica la documentación requerida para desarrollar el trabajo.\n' +
        '- Mantener la comunicación mediante WhatsApp o correo electrónico dentro de los horarios laborales estipulados.\n' +
        '- Efectuar los pagos puntualmente mediante los canales oficiales descritos en el contrato.\n' +
        '- Remitir únicamente las observaciones realizadas por el docente asesor o el jurado evaluador universitario.\n' +
        '- Seguir las pautas del departamento académico sobre el contacto con los evaluadores.'
    },
    {
      title: 'RETRIBUCIÓN ECONÓMICA Y FORMA DE PAGO',
      body:
        'El costo global del servicio asciende a {{monto}}, dividido en los siguientes tramos:\n\n' +
        '{{cronograma_pagos}}\n\n' +
        // El texto del Word decía "cuentas corrientes corporativas (…) a nombre
        // de Avantage Group S.A.C.", y eso contradecía la tabla de justo abajo:
        // la de Interbank está a nombre del gerente general. Se describe por el
        // detalle en vez de afirmar un titular que no es el de las dos.
        'Medios de pago autorizados: cuentas corrientes en BCP e Interbank según el detalle siguiente, ' +
        'o abono presencial en efectivo en la oficina principal.\n\n' +
        '{{cuentas_bancarias}}'
    },
    {
      title: 'CRONOGRAMA DE ENTREGAS',
      body:
        'Las entregas que EL LOCADOR otorgará a favor de EL ASESORADO serán cargadas al correo y/o grupo de ' +
        'WhatsApp creado en los siguientes términos:\n\n' +
        '{{cronograma_entregas}}'
    },
    {
      title: 'EXCLUSIVIDAD',
      body:
        'El servicio es estrictamente personal entre el cliente y la empresa. En caso de requerir la inclusión ' +
        'de terceras personas o ampliar el alcance, se deberá firmar una adenda con el reajuste de costos ' +
        'correspondiente. La empresa se reserva el derecho de rechazar modificaciones al alcance sin previo ' +
        'acuerdo por escrito.'
    },
    {
      title: 'ANULACIÓN O CANCELACIÓN CONTRACTUAL',
      body:
        '- Por mutuo acuerdo: Se rescinde el contrato sin penalidades o consecuencias jurídicas para ninguna de las partes.\n' +
        '- Cancelación a solicitud del cliente: Debe adjuntar justificación sustentada vía correo electrónico para evaluación. En ningún caso conllevará devolución del dinero abonado, el cual cubre gastos operativos, logísticos y administrativos.'
    },
    {
      title: 'MORA INDEMNIZATORIA Y PENALIDADES',
      body:
        '- Mora en pagos del cliente: Se concede una tolerancia de 2 días calendario. A partir del tercer día, se aplicará un recargo indemnizatorio de S/. 15.00 diarios con carácter retroactivo.\n' +
        '- Atraso de la empresa: Cuenta con una tolerancia de 2 días hábiles para las entregas. Si se excede sin justificación, el cliente podrá exigir un descuento/reembolso de S/. 15.00 diarios de retraso.'
    },
    {
      title: 'CONFIDENCIALIDAD',
      body:
        'La empresa mantendrá en estricta reserva los datos personales del cliente de forma indefinida, incluso ' +
        'tras la finalización del contrato, salvo mandato legal.'
    },
    {
      title: 'SUSPENSIÓN Y REPROGRAMACIÓN POR INACTIVIDAD DEL ASESORADO',
      body:
        '10.1. En caso de que EL ASESORADO deje de comunicarse, suspenda la atención al proyecto o no responda ' +
        'a los requerimientos de información por un periodo ininterrumpido igual o mayor a tres (3) meses ' +
        '(90 días calendario), la ejecución del presente contrato quedará en estado de suspensión temporal por ' +
        'inactividad.\n\n' +
        '10.2. Cuando EL ASESORADO decida retomar el servicio, la reanudación estará sujeta a las siguientes ' +
        'condiciones:\n\n' +
        'A. Disponibilidad y nuevos plazos: el cronograma de entregas fijado en la cláusula quinta quedará sin ' +
        'efecto. Las nuevas fechas de avance se reprogramarán en función de la disponibilidad de agenda, ' +
        'capacidad operativa y tiempos que determine EL LOCADOR al momento del retorno.\n\n' +
        'B. Inexigibilidad de penalidades: durante el periodo de inactividad y posterior reprogramación, no ' +
        'aplicará ningún tipo de mora, indemnización, reembolso o penalidad a cargo de EL LOCADOR de las ' +
        'estipuladas en la cláusula octava.\n\n' +
        'C. Actualización de parámetros académicos: si la inactividad supera los tres (3) meses, EL LOCADOR se ' +
        'reserva el derecho de evaluar si el trabajo requiere ajustes o actualizaciones conforme a nuevos ' +
        'reglamentos, esquemas, lineamientos o normas de citación vigentes en la universidad correspondiente al ' +
        'momento de la reanudación.'
    },
    {
      title: 'MEDIDAS DISCIPLINARIAS',
      body:
        'Conductas hostiles o faltas de respeto hacia el personal de la empresa causarán la pérdida automática ' +
        'de los beneficios adicionales. De no contar con ellos, se aplicará una sanción económica de hasta ' +
        'S/. 50.00.'
    },
    {
      title: 'SOLUCIÓN DE CONTROVERSIAS',
      body:
        'Cualquier desacuerdo se resolverá primeramente mediante Conciliación Extrajudicial. De persistir la ' +
        'controversia, las partes se someterán al fuero arbitral de la Cámara de Comercio de Lima.'
    },
    {
      title: 'PROGRAMA DE REFERIDOS',
      body:
        'Si el cliente refiere a un tercero que celebre un contrato similar, recibirá una bonificación de ' +
        'S/. 50.00 por cada S/. 1,000.00 de ingreso efectivamente percibido por la empresa.'
    },
    {
      title: 'ALCANCE DE LA GARANTÍA',
      body:
        'La garantía no tiene fecha de caducidad por tiempo: las obligaciones de la empresa se extinguen ' +
        'únicamente cuando el cliente obtenga el informe aprobatorio de los tres jurados de tesis, en la ' +
        'sustentación como en la versión escrita del trabajo. El cliente asume la responsabilidad si los ' +
        'errores provienen de información falsa, incorrecta o por la influencia de terceros ajenos al proceso.'
    }
  ],
  // Sin la ciudad: el contrato se firma a distancia casi siempre (el asesorado
  // puede estar en otra región), así que nombrar una ciudad de firma era
  // declarar algo que no pasó. La fecha sí se mantiene.
  closing:
    'Las partes declaran haber leído el contrato, por lo que conocen y aceptan todas las cláusulas en su ' +
    'integridad, y ambos firman el {{fecha}}.'
};
