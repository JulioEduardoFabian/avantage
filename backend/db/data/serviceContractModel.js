/**
 * Modelo real de contrato de locación de servicios de Avantage Group, tal
 * como lo usa el área legal (documento "MODELO DE CONTRATO.docx"): 14
 * cláusulas con sus subcláusulas, el cronograma de pagos, las cuentas de
 * abono y el cronograma de entregas.
 *
 * Reemplaza al texto genérico de `defaultContractTemplates.js`, que era un
 * punto de partida provisional ("debe ser revisado por el área legal"). Ese
 * archivo NO se toca: lo sigue usando la migración que lo cargó en su
 * momento, y reescribirlo cambiaría lo que se carga en una base nueva.
 *
 * Lo carga la migración 20261013000000_load_service_contract_model.js.
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
 * Los dos cronogramas NO se escriben en el texto de la cláusula: van como
 * marcador. Las cuotas salen de las mismas filas que Finanzas cobra y las
 * entregas de `contract_deliverables`; las dos se editan en el formulario del
 * contrato. Cuando se tecleaban a mano, la tabla quedaba vacía en la mitad de
 * los contratos, o con fechas que ya no coincidían con lo pactado porque
 * alguien reprogramó un pago en Finanzas y nadie volvió a tocar la cláusula.
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
      title: 'OBJETO DEL CONTRATO',
      body:
        'EL CONTRATO se celebra con el objeto de que EL LOCADOR entregue a favor de EL ASESORADO un producto ' +
        'académico según los parámetros del contrato y la observancia del reglamento de la {{universidad}} y la ' +
        'carrera o mención de {{carrera}}.'
    },
    {
      title: 'OBLIGACIONES DEL LOCADOR',
      body:
        'EL LOCADOR se compromete a cumplir con lo siguiente:\n\n' +
        '- Entregar productos originales que garanticen bajos niveles de similitud con respecto de otros trabajos de investigación.\n' +
        '- Levantar las observaciones advertidas por los revisores universitarios hasta la obtención del informe que aprueba la sustentación.\n' +
        '- Ceder los derechos de propiedad intelectual a favor de EL ASESORADO, para los fines que este considere pertinentes.\n' +
        '- No divulgar los datos de EL ASESORADO, salvo necesidad inexcusable o solicitud propia del mismo.\n' +
        '- No utilizar el producto académico para fines que no sean los estipulados en EL CONTRATO.'
    },
    {
      title: 'OBLIGACIONES DEL ASESORADO',
      body:
        'EL ASESORADO se compromete a cumplir con lo siguiente:\n\n' +
        '- Proporcionar la información de aplicación de instrumentos.\n' +
        '- Proporcionar información sobre el lugar de estudio, la población y muestra.\n' +
        '- Proporcionar al departamento académico la información y documentos necesarios para la prestación del servicio.\n' +
        '- Comunicarse dentro del horario de oficina y mediante WhatsApp o correo electrónico.\n' +
        '- Otorgar observaciones únicamente advertidas por el asesor universitario o los jurados revisores.\n' +
        '- Atender a las recomendaciones de departamento académico sobre la comunicación con asesor y jurados universitarios.\n' +
        '- Abonar los pagos establecidos de manera puntual y únicamente mediante los medios de pago oficiales descritos en la cláusula cuarta.'
    },
    {
      title: 'COSTO Y FORMA DEL PAGO',
      body:
        'Como contraprestación al servicio prestado por EL LOCADOR, EL ASESORADO se compromete al abono de un monto ' +
        'total de {{monto}}, monto que será abonado en las siguientes fechas:\n\n' +
        '{{cronograma_pagos}}\n\n' +
        'El pago será abonado bajo las siguientes modalidades:\n\n' +
        '- Efectivo: estrictamente abonado en las oficinas de la empresa.\n' +
        '- Depósito o transferencia bancaria a las siguientes cuentas:\n\n' +
        '{{cuentas_bancarias}}'
    },
    {
      title: 'ENTREGAS Y FORMA DE ENTREGAS',
      body:
        'Las entregas que EL LOCADOR otorgará a favor de EL ASESORADO serán cargadas al correo y/o grupo de ' +
        'WhatsApp creado en los siguientes términos:\n\n' +
        '{{cronograma_entregas}}\n\n' +
        'Además, EL LOCADOR se compromete con entregar a favor de EL ASESORADO los siguientes beneficios adicionales:\n\n' +
        '- Asesoría de preparación metodológica y temática sobre la investigación para la sustentación.\n' +
        '- Balotario de preguntas de sustentación.\n' +
        '- Plantilla de diapositivas en Power Point para la sustentación.\n' +
        '- Reporte de Turnitin e IA.'
    },
    {
      title: 'EXCLUSIVIDAD',
      body:
        'En virtud de esta cláusula, el contrato suscrito se establece exclusivamente entre EL LOCADOR y ' +
        'EL ASESORADO. Cualquier ampliación relacionada al alcance del servicio que incluya a otras personas ' +
        'requiere una notificación y adenda escrita, junto con la aceptación de los términos y costos adicionales ' +
        'por ambas partes. EL ASESORADO asume la responsabilidad total de los pagos adicionales relacionados con ' +
        'cualquier extensión del servicio. EL LOCADOR se reserva el derecho de rechazar dicha ampliación sin ' +
        'consentimiento previo por escrito. Esta cláusula garantiza la transparencia y evita malentendidos en caso ' +
        'de cambios en el alcance de los servicios. Ambas partes aceptan estos términos mediante la firma del contrato.'
    },
    {
      title: 'SOBRE LA RESOLUCIÓN DEL CONTRATO',
      body:
        'Si existe un acuerdo de LAS PARTES para la resolución del contrato, este podrá ser resuelto sin ' +
        'consecuencias jurídicas que perjudiquen a las mismas.\n\n' +
        'En caso de que EL LOCADOR incumpla sus obligaciones sin que exista una justificación suficiente que haya ' +
        'escapado a su voluntad, este deberá reintegrar a EL ASESORADO el total de los pagos abonados por este último.\n\n' +
        'En caso de que EL ASESORADO manifieste la intención de resolver el contrato, este deberá adjuntar mediante ' +
        'correo electrónico medios probatorios suficientes que justifiquen su solicitud, la cual será evaluada por la ' +
        'gerencia de EL LOCADOR. Bajo ninguna circunstancia, la resolución del contrato a pedido de EL ASESORADO ' +
        'conllevará a devolución de los pagos abonados hasta el momento de aprobación o denegación de la solicitud; ' +
        'pagos utilizados para la cobertura de gastos operativos, logísticos, administrativos y de mercadotecnia.'
    },
    {
      title: 'MORA INDEMNIZATORIA Y PENALIDADES',
      body:
        '8.1. Sobre los pagos\n' +
        'EL ASESORADO tendrá una prórroga de hasta 2 días calendario para abonar los montos descritos en la cláusula ' +
        'cuarta de EL CONTRATO. A partir del tercer día calendario siguiente al vencimiento de la fecha de pago, ' +
        'EL ASESORADO deberá abonar una mora indemnizatoria de S/.15.00 (quince soles) por cada día que no ha ' +
        'realizado el pago, lo cual tendrá efecto retroactivo desde el primer día de incumplimiento de pago.\n\n' +
        '8.2. Sobre la resolución de contrato a pedido de parte\n' +
        'En caso de que EL ASESORADO manifieste la intención de resolver el presente contrato, sin que ello esté ' +
        'contenido en la descripción de la cláusula sexta, este deberá pagar a favor de EL LOCADOR un monto ' +
        'indemnizatorio por incumplimiento de obligaciones contraprestativas que ascenderá a un 20% del monto total ' +
        'que EL ASESORADO estuviera pendiente de abonar, según el cronograma de la cláusula cuarta de EL CONTRATO.\n\n' +
        '8.3. Sobre las entregas\n' +
        'EL LOCADOR tendrá una prórroga de hasta dos días hábiles para la entrega de los avances contenidos en la ' +
        'cláusula quinta de EL CONTRATO. En caso de que EL LOCADOR cumpla tardíamente y sin justificación razonable ' +
        'con la entrega, EL ASESORADO tendrá la posibilidad de exigir un reembolso de S/.15.00 (quince soles) diarios ' +
        'por cada día de retraso en la entrega del producto académico correspondiente.'
    },
    {
      title: 'CONFIDENCIALIDAD',
      body:
        'EL LOCADOR se compromete a mantener en reserva todos los datos de EL ASESORADO, incluso después de que las ' +
        'demás obligaciones de EL CONTRATO se hayan extinguido; a excepción de aquellos casos que la ley exija lo contrario.'
    },
    {
      title: 'GARANTÍA DEL SERVICIO',
      body:
        'EL CONTRATO no tiene una cláusula de prescripción de obligaciones por parte de EL LOCADOR que se rija por el ' +
        'tiempo, sino que las obligaciones de este se extinguen únicamente cuando EL ASESORADO haya obtenido el ' +
        'informe aprobatorio de los tres jurados revisores de la tesis.\n\n' +
        'EL ASESORADO asume la responsabilidad sobre todo tipo de negligencia que pudiera aparecer en el producto ' +
        'académico, cuando esta es ocasionada por sí mismo, esto es, cuando la información proporcionada por ' +
        'EL ASESORADO es ilegítima, incorrecta, o influenciada por terceras personas ajenas al vínculo contractual o ' +
        'personal universitario.'
    },
    {
      title: 'SANCIONES',
      body:
        'En caso de que EL ASESORADO muestre conductas hostiles hacia cualquier miembro de la organización, este ' +
        'perderá automáticamente todos los beneficios adicionales contenidos en EL CONTRATO. Además, en caso el ' +
        'servicio no contenga beneficios adicionales, se sancionará a EL ASESORADO con un bono excedente de hasta ' +
        'S/.50.00 (cincuenta soles).'
    },
    {
      title: 'SOLUCIÓN DE CONFLICTOS',
      body:
        'En caso de desacuerdo durante la ejecución del presente contrato, estos deberán solucionarlo mediante ' +
        'conciliación extrajudicial. En caso de presentarse cualquier asunto dudoso o litigioso derivado de la ' +
        'interpretación, aplicación o ejecución del presente contrato, las partes se someterán al fuero arbitral de ' +
        'la Cámara de Comercio de Lima según desee el interesado.'
    },
    {
      title: 'BONIFICACIONES',
      body:
        'En caso de que EL ASESORADO refiera a EL LOCADOR y este celebre un contrato de índole similar a la del ' +
        'presente contrato, EL LOCADOR otorgará a EL ASESORADO una bonificación de S/.50.00 (cincuenta soles) por ' +
        'cada mil soles de ingreso con los que la empresa se vea beneficiada.'
    },
    {
      title: 'SUSPENSIÓN Y REPROGRAMACIÓN POR INACTIVIDAD DEL ASESORADO',
      body:
        '14.1. En caso de que EL ASESORADO deje de comunicarse, suspenda la atención al proyecto o no responda a los ' +
        'requerimientos de información por un periodo ininterrumpido igual o mayor a tres (3) meses (90 días ' +
        'calendario), la ejecución del presente contrato quedará en estado de suspensión temporal por inactividad.\n\n' +
        '14.2. Cuando EL ASESORADO decida retomar el servicio, la reanudación estará sujeta a las siguientes condiciones:\n\n' +
        // A/B/C van como párrafos, no como viñetas: ya traen su propia letra
        // del documento original y la viñeta la duplicaba. Es el mismo trato
        // que reciben los numerales 8.1/8.2/8.3.
        'A. Disponibilidad y nuevos plazos: el cronograma de entregas fijado en la cláusula quinta quedará sin ' +
        'efecto. Las nuevas fechas de avance se reprogramarán en función de la disponibilidad de agenda, capacidad ' +
        'operativa y tiempos que determine EL LOCADOR al momento del retorno.\n\n' +
        'B. Inexigibilidad de penalidades: durante el periodo de inactividad y posterior reprogramación, no ' +
        'aplicará ningún tipo de mora, indemnización, reembolso o penalidad a cargo de EL LOCADOR de las estipuladas ' +
        'en la cláusula octava.\n\n' +
        'C. Actualización de parámetros académicos: si la inactividad supera los tres (3) meses, EL LOCADOR se ' +
        'reserva el derecho de evaluar si el trabajo requiere ajustes o actualizaciones conforme a nuevos ' +
        'reglamentos, esquemas, lineamientos o normas de citación vigentes en la universidad correspondiente al ' +
        'momento de la reanudación.'
    }
  ],
  closing:
    'Las partes declaran haber leído el contrato, por lo que conocen y aceptan todas las cláusulas en su ' +
    'integridad, y ambos firman en la ciudad de {{ciudad}}, el {{fecha}}.'
};
