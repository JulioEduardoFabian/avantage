/**
 * Catálogo cerrado de universidades peruanas (sigla/alias -> nombre oficial).
 * Es la fuente de verdad que `universityNormalizer.js` consulta ANTES de
 * confiar en cualquier respuesta del LLM: siglas parecidas ("UNAC" vs
 * "UNCP") o nombres cortos ambiguos ("Villarreal") se resuelven acá de forma
 * determinística, sin depender de que el modelo "adivine bien" cada vez.
 *
 * Cada alias se compara ya normalizado (minúsculas, sin tildes) contra el
 * texto del contacto — ver `normalizeToken()` en `universityNormalizer.js`.
 * Gana el alias MÁS LARGO de todo el catálogo, no el de la primera entrada de
 * la lista: con el primero ganando, un alias genérico ("catolica") de una
 * entrada temprana tapaba el nombre propio de otra ("sedes sapientiae").
 */
export const PERU_UNIVERSITIES = [
  { name: 'Universidad Nacional Mayor de San Marcos', aliases: ['unmsm', 'san marcos', 'sanmarcos'] },
  { name: 'Universidad Nacional de Ingeniería', aliases: ['uni'] },
  { name: 'Universidad Nacional del Callao', aliases: ['unac', 'callao'] },
  { name: 'Universidad Nacional Federico Villarreal', aliases: ['unfv', 'villarreal', 'federico villarreal'] },
  { name: 'Universidad Nacional del Centro del Perú', aliases: ['uncp', 'centro del peru'] },
  { name: 'Universidad César Vallejo', aliases: ['ucv', 'cesar vallejo'] },
  { name: 'Universidad Tecnológica del Perú', aliases: ['utp'] },
  { name: 'Universidad de San Martín de Porres', aliases: ['usmp', 'san martin de porres'] },
  { name: 'Universidad Nacional de San Antonio Abad del Cusco', aliases: ['unsaac', 'san antonio abad'] },
  { name: 'Universidad Peruana de Ciencias Aplicadas', aliases: ['upc'] },
  { name: 'Pontificia Universidad Católica del Perú', aliases: ['pucp', 'pontificia', 'pontificia catolica', 'catolica del peru'] },
  // Las "católicas" son varias y comparten la misma palabra. Cada una entra
  // con su nombre propio para que gane el alias más específico (ver
  // `matchCatalog`), y "catolica" a secas queda como término AMBIGUO: no
  // resuelve a ninguna. Caso real (15/10/2026): "Universidad católica Sedes
  // Sapientiae" se confirmó como "Pontificia Universidad Católica del Perú".
  { name: 'Universidad Católica Sedes Sapientiae', aliases: ['ucss', 'sedes sapientiae', 'sapientiae', 'catolica sedes sapientiae'] },
  { name: 'Universidad Católica de Santa María', aliases: ['ucsm', 'santa maria', 'catolica de santa maria', 'catolica santa maria'] },
  { name: 'Universidad Católica San Pablo', aliases: ['ucsp', 'san pablo', 'catolica san pablo'] },
  { name: 'Universidad Católica Santo Toribio de Mogrovejo', aliases: ['usat', 'santo toribio', 'santo toribio de mogrovejo'] },
  { name: 'Universidad Católica de Trujillo Benedicto XVI', aliases: ['uct', 'catolica de trujillo'] },
  { name: 'Universidad Católica Los Ángeles de Chimbote', aliases: ['uladech', 'los angeles de chimbote', 'catolica los angeles de chimbote'] },
  { name: 'Universidad Nacional Tecnológica de Lima Sur', aliases: ['untels'] },
  { name: 'Universidad de Ciencias y Humanidades', aliases: ['uch'] },
  { name: 'Universidad Continental', aliases: ['continental', 'la continental'] },
  { name: 'Universidad Peruana Los Andes', aliases: ['upla'] },
  { name: 'Universidad Nacional Daniel Alcides Carrión', aliases: ['undac'] },
  { name: 'Universidad Nacional de San Agustín', aliases: ['unsa', 'san agustin'] },
  { name: 'Universidad de Lima', aliases: ['ulima'] },
  { name: 'Universidad San Ignacio de Loyola', aliases: ['usil'] },
  { name: 'Universidad Privada del Norte', aliases: ['upn'] },
  { name: 'Universidad Andina del Cusco', aliases: ['uandina', 'andina del cusco'] },
  { name: 'Universidad Nacional de Trujillo', aliases: ['unt', 'universidad nacional de trujillo'] },
  { name: 'Universidad Ricardo Palma', aliases: ['urp', 'ricardo palma'] },
  { name: 'Universidad ESAN', aliases: ['esan'] }
];

/**
 * Términos que varias universidades comparten: por sí solos NO identifican a
 * ninguna. Un match que dependa únicamente de uno de ellos baja a confianza
 * media, así el bot se queda con el texto que escribió el contacto en vez de
 * confirmarle una universidad que nadie nombró.
 */
export const AMBIGUOUS_UNIVERSITY_TERMS = new Set([
  'catolica',
  'la catolica',
  'universidad catolica',
  'nacional',
  'particular',
  'privada'
]);
