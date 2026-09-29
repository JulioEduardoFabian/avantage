/**
 * Documento imprimible (A4) de un contrato, con la marca de Avantage Group.
 * Se abre en una pestaña con el botón "Imprimir / Guardar como PDF": el
 * diálogo de impresión del navegador produce el PDF, sin depender de un
 * motor de PDF en el servidor (el hosting compartido no puede correr uno).
 *
 * A diferencia de la cotización (una sola hoja con bandas de color), un
 * contrato ocupa varias páginas: los márgenes van en `@page` para que el
 * texto fluya página a página con el mismo margen en cada una.
 */
import { COMPANY, PAYMENT_METHODS, agMarkPaths, esc } from './quotationDocument.js';
import { readFileSync } from 'fs';

/**
 * Firma y sello de EL LOCADOR, impresos por defecto en todos los contratos
 * (también en borradores, que ya llevan la marca de agua; no en anulados).
 * Se incrusta como data URI para que salga igual en la pestaña de impresión
 * (abierta desde un blob, sin acceso a rutas del servidor) y en el PDF. Si
 * el archivo no está, el contrato sale sin firma en vez de fallar.
 */
// Firmante que aparece en la imagen de firma y sello: se usa como
// representante de EL LOCADOR cuando el contrato no indica otro, para que la
// apertura ("debidamente representada por...") coincida con la firma.
const LESSOR_SIGNER = 'Julio Fabián Ninamango, Gerente General';

const LESSOR_SIGNATURE = (() => {
  try {
    const png = readFileSync(new URL('../assets/firma-sello-locador.png', import.meta.url));
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    console.warn('⚠️ [Contratos] No se encontró backend/assets/firma-sello-locador.png: los contratos saldrán sin firma del locador.');
    return null;
  }
})();

/**
 * Logo oficial de Avantage Group. Va embebido como data URI, igual que la
 * firma: el documento se abre en el navegador y se imprime a PDF desde ahí,
 * así que no puede depender de que el servidor sirva un archivo aparte.
 *
 * El PNG trae el trazo sobre fondo transparente (el original venía con fondo
 * crema, que sobre la hoja blanca se veía como un recuadro). Si el archivo
 * falta, el encabezado cae en la marca vectorial de siempre en vez de quedar
 * sin identificación.
 */
const BRAND_LOGO = (() => {
  try {
    const png = readFileSync(new URL('../assets/logo-avantage.png', import.meta.url));
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    console.warn('⚠️ [Contratos] No se encontró backend/assets/logo-avantage.png: se usará la marca vectorial de respaldo.');
    return null;
  }
})();

const BLANK = '____________________';

const ORDINALS = ['PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'SEXTA', 'SÉPTIMA', 'OCTAVA', 'NOVENA'];
const TENS_ORDINALS = { 10: 'DÉCIMA', 20: 'VIGÉSIMA', 30: 'TRIGÉSIMA' };

/** 1 → "PRIMERA", 12 → "DÉCIMA SEGUNDA", 20 → "VIGÉSIMA". */
export function clauseOrdinal(n) {
  if (n < 10) return ORDINALS[n - 1];
  const tens = Math.floor(n / 10) * 10;
  if (!TENS_ORDINALS[tens]) return `CLÁUSULA ${n}`;
  return n % 10 ? `${TENS_ORDINALS[tens]} ${ORDINALS[(n % 10) - 1]}` : TENS_ORDINALS[tens];
}

/**
 * El título de la cláusula, sin el "CLÁUSULA PRIMERA:" que el encabezado ya
 * pone por su cuenta.
 *
 * El encabezado se arma con el ordinal calculado por la POSICIÓN de la
 * cláusula, así que mover o insertar una cláusula renumera todo solo. Pero el
 * campo del título es libre y varias cláusulas quedaron escritas a mano como
 * "CLÁUSULA PRIMERA: FINALIDAD DEL CONTRATO", y el resultado impreso era
 * "PRIMERA: CLÁUSULA PRIMERA: FINALIDAD DEL CONTRATO". Peor: ese ordinal
 * escrito a mano NO se renumera, así que movida la cláusula decía una cosa en
 * el prefijo y otra en el título.
 *
 * Se limpia al imprimir y no en la base de datos a propósito: lo que el
 * usuario escribió se conserva tal cual en el editor.
 */
const TYPED_ORDINAL_RE = /^\s*(?:cl[áa]usula\s+)?(?:primera|segunda|tercera|cuarta|quinta|sexta|s[ée]ptima|octava|novena|d[ée]cima|vig[ée]sima|trig[ée]sima)(?:\s+(?:primera|segunda|tercera|cuarta|quinta|sexta|s[ée]ptima|octava|novena))?\s*[:.\-–]\s*/i;

export function clauseHeadingTitle(title) {
  return String(title || '').replace(TYPED_ORDINAL_RE, '').trim() || String(title || '').trim();
}

const UNITS = [
  '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'
];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function below1000(n) {
  if (n === 100) return 'cien';
  const rest = n % 100;
  const restWords = rest < 30 ? UNITS[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` y ${UNITS[rest % 10]}` : ''}`;
  return [HUNDREDS[Math.floor(n / 100)], restWords].filter(Boolean).join(' ');
}

// "uno" pierde la -o delante de mil/millones: "veintiún mil", "treinta y un mil".
function apocope(words) {
  return words.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
}

/** Parte entera en letras: 5200 → "cinco mil doscientos". */
export function numberToWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return 'cero';
  const millions = Math.floor(n / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const units = n % 1000;
  const parts = [];
  if (millions) parts.push(millions === 1 ? 'un millón' : `${apocope(numberToWords(millions))} millones`);
  if (thousands) parts.push(thousands === 1 ? 'mil' : `${apocope(below1000(thousands))} mil`);
  if (units) parts.push(below1000(units));
  return parts.join(' ');
}

/** 5200 → "S/ 5,200.00 (CINCO MIL DOSCIENTOS CON 00/100 SOLES)". */
export function formatAmountLegal(amount, currency = 'PEN') {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  const totalCents = Math.round(value * 100);
  const cents = String(totalCents % 100).padStart(2, '0');
  const symbol = currency === 'USD' ? 'US$' : 'S/';
  const currencyWords = currency === 'USD' ? 'DÓLARES AMERICANOS' : 'SOLES';
  const figure = (totalCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol} ${figure} (${numberToWords(Math.floor(totalCents / 100)).toUpperCase()} CON ${cents}/100 ${currencyWords})`;
}

function formatLongDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatContractNumber(contract) {
  const year = String(contract.created_at ? new Date(contract.created_at).getFullYear() : new Date().getFullYear());
  return `CTR-${year}-${String(contract.id).padStart(4, '0')}`;
}

/** Valores de los marcadores {{...}}. Un dato que falta queda como línea para llenar a mano. */
export function contractPlaceholders(contract) {
  return {
    empresa: COMPANY.legalName,
    ruc: COMPANY.ruc,
    // Solo la calle: la comparecencia sigue con ", representada legalmente por
    // {{representante}}", y repetir ahí la ciudad ("Calle Neptuno 185,
    // Huancayo, Huancayo - Perú, representada legalmente por…") alargaba la
    // frase sin aportar nada. La ciudad completa se mantiene en `COMPANY` para
    // la cotización, el comprobante y la base de conocimiento del bot.
    domicilio_empresa: COMPANY.address,
    representante: contract.representative_name || (LESSOR_SIGNATURE ? LESSOR_SIGNER : null),
    cliente: contract.client_name,
    dni: contract.client_dni,
    domicilio: contract.client_address,
    correo: contract.client_email,
    telefono: contract.client_phone,
    servicio: contract.service_description,
    monto: formatAmountLegal(contract.total_amount, contract.currency),
    ciudad: contract.city,
    fecha: formatLongDate(contract.contract_date),
    universidad: contract.university,
    carrera: contract.career
  };
}

/**
 * Marcadores que no son un dato suelto sino un BLOQUE (hoy, una tabla). Se
 * expanden ANTES de partir el cuerpo en bloques, porque lo que devuelven son
 * filas que el parser tiene que leer después como tabla; pasarlos por
 * fillPlaceholders() las envolvería en <strong> y las dejaría como una línea
 * suelta de texto.
 *
 * Las cuentas salen de PAYMENT_METHODS —la misma lista que imprime las
 * cotizaciones—, así que un cambio de cuenta no puede quedar desfasado entre
 * un documento y otro.
 */
const BLOCK_PLACEHOLDERS = {
  cuentas_bancarias: () => [
    'Banco | Moneda | Titular y número de cuenta',
    ...PAYMENT_METHODS.map((m) => `${m.bank} | Soles | ${m.holder || COMPANY.legalName} ${m.account}${m.cci ? ` — ${m.cci}` : ''}`)
  ].join('\n'),

  /**
   * El cronograma que se imprime es el mismo que Finanzas va a cobrar (las
   * cuotas del lead), no una tabla escrita a mano en la cláusula: si alguien
   * reprograma un pago, el contrato reimpreso ya sale con la fecha nueva.
   */
  cronograma_pagos: (contract) => {
    const rows = contract?.installments || [];
    const symbol = contract?.currency === 'USD' ? 'US$' : 'S/';
    if (rows.length === 0) return 'Fecha | Monto en soles\nA convenir entre las partes | ';
    return [
      'Fecha | Monto en soles',
      ...rows.map((r) => {
        // Siempre con los dos decimales: "S/ 750" en un contrato se presta a
        // discusión sobre los céntimos, "S/ 750.00" no.
        const amount = Number(r.monto).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `${formatLongDate(r.due_date || r.fecha) || 'Por definir'} | ${symbol} ${amount}`;
      })
    ].join('\n');
  },

  /**
   * El cronograma de entregas de la cláusula quinta. Son filas propias del
   * contrato (`contract_deliverables`): se escriben en el mismo formulario que
   * las cuotas y se imprimen acá, en vez de teclear la tabla dentro del texto
   * de la cláusula —que era lo que se hacía y lo que dejaba contratos con la
   * tabla vacía o con fechas que ya no coincidían con lo pactado.
   */
  cronograma_entregas: (contract) => {
    const rows = contract?.deliverables || [];
    if (rows.length === 0) return 'Fecha | Avance\nPor definir | ';
    return [
      'Fecha | Avance',
      ...rows.map((r) => `${formatLongDate(r.due_date) || 'Por definir'} | ${r.avance || ''}`)
    ].join('\n');
  }
};

function expandBlockPlaceholders(text, contract) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key) => (
    BLOCK_PLACEHOLDERS[key] ? BLOCK_PLACEHOLDERS[key](contract) : match
  ));
}

/** Escapa el texto y reemplaza los marcadores; los desconocidos se dejan tal cual. */
export function fillPlaceholders(text, values) {
  return esc(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key) => {
    if (!(key in values)) return match;
    const value = values[key];
    return value ? `<strong>${esc(value)}</strong>` : BLANK;
  });
}

/**
 * Una fila de tabla: al menos un "|" en cada línea del bloque. Se eligió la
 * forma de Markdown porque las cláusulas se editan en un textarea del panel:
 * quien redacta un contrato tiene que poder escribir el cronograma de pagos
 * sin saber HTML.
 */
function isTableBlock(block) {
  const lines = block.split(/\n/).filter((l) => l.trim());
  return lines.length >= 2 && lines.every((l) => l.includes('|'));
}

function tableBlock(block, values) {
  const rows = block.split(/\n/).map((l) => l.trim()).filter(Boolean)
    // La fila separadora de Markdown (|---|---|) no es contenido: si alguien
    // la escribe por costumbre, se ignora en vez de imprimirse como celda.
    .filter((l) => !/^\|?[\s|:-]+\|[\s|:-]*$/.test(l))
    // Los "|" de los extremos son opcionales (como en Markdown), pero solo se
    // quitan cuando están en AMBOS lados: una fila con la primera celda vacía
    // se escribe " | Firma de contrato", y quitarle ese "|" de la izquierda
    // se comería la celda vacía en vez del delimitador.
    .map((l) => (l.length > 1 && l.startsWith('|') && l.endsWith('|') ? l.slice(1, -1) : l))
    .map((l) => l.split('|').map((c) => c.trim()));

  const [head, ...body] = rows;
  const cells = (row, tag) => row.map((c) => `<${tag}>${c ? fillPlaceholders(c, values) : ''}</${tag}>`).join('');
  // Una fila más corta que el encabezado se completa con celdas vacías: sin
  // esto, una fila del cronograma todavía sin llenar rompía la cuadrícula.
  const padded = (row) => row.concat(Array(Math.max(0, head.length - row.length)).fill(''));
  return '<table class="c-table">'
    + `<thead><tr>${cells(head, 'th')}</tr></thead>`
    + `<tbody>${body.map((r) => `<tr>${cells(padded(r), 'td')}</tr>`).join('')}</tbody>`
    + '</table>';
}

/** Bloque de viñetas: todas sus líneas empiezan con "- ". */
function isListBlock(block) {
  const lines = block.split(/\n/).filter((l) => l.trim());
  return lines.length > 0 && lines.every((l) => /^\s*-\s+/.test(l));
}

function listBlock(block, values) {
  const items = block.split(/\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => `<li>${fillPlaceholders(l.replace(/^-\s+/, ''), values)}</li>`).join('');
  return `<ul class="c-list">${items}</ul>`;
}

/**
 * Cuerpo de una cláusula (o la apertura/cierre) a HTML. Los bloques se
 * separan por línea en blanco y cada uno se imprime como tabla, lista de
 * viñetas o párrafo, según su forma.
 */
function paragraphs(text, values, contract) {
  return expandBlockPlaceholders(text, contract)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (isTableBlock(p)) return tableBlock(p, values);
      if (isListBlock(p)) return listBlock(p, values);
      return `<p>${fillPlaceholders(p, values).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

const WATERMARKS = { borrador: 'BORRADOR', anulado: 'ANULADO' };

export function buildContractDocument(contract) {
  const values = contractPlaceholders(contract);
  const number = formatContractNumber(contract);
  const watermark = WATERMARKS[contract.status];
  const showSignature = LESSOR_SIGNATURE && contract.status !== 'anulado';
  // La imagen ya trae la razón social, el nombre y el cargo del firmante:
  // bajo la línea solo va el RUC. Sin imagen, el bloque va completo.
  const lessorCaption = showSignature
    ? `RUC ${esc(COMPANY.ruc)}`
    : `${esc(COMPANY.legalName)}<br>RUC ${esc(COMPANY.ruc)}<br>${esc(contract.representative_name || 'Representante legal')}`;

  const clauses = (contract.clauses || []).map((clause, i) => `
    <section class="c-clause">
      <h3><span>CLÁUSULA ${clauseOrdinal(i + 1)}:</span> ${esc(clauseHeadingTitle(clause.title))}</h3>
      ${paragraphs(clause.body, values, contract)}
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(number)} — ${esc(contract.client_name || 'Contrato')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&family=Source+Serif+4:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #e9e8e1; color: #1f1f1c; font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.55; font-variant-numeric: lining-nums; }

  .c-sheet { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto 24px; padding: 22mm 20mm 20mm; background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,0.12); }
  .c-watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0;
    font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 96pt; letter-spacing: 8px; color: rgba(178,58,44,0.08); transform: rotate(-32deg); }
  .c-content { position: relative; z-index: 1; }

  .c-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; margin-bottom: 18px; border-bottom: 2px solid #8a9b30; font-family: 'Montserrat', sans-serif; }
  .c-brand { display: flex; align-items: center; gap: 10px; }
  .c-brand svg { width: 42px; height: 35px; }
  /* El logo lleva su propio texto, así que manda el alto y el ancho sigue su
     proporción. print-color-adjust para que el olivo no salga en gris. */
  .c-logo { height: 38px; width: auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c-brand small { font-size: 7.5pt; color: #5d5e51; letter-spacing: 0.4px; }
  .c-number { text-align: right; font-size: 8pt; color: #5d5e51; }
  .c-number b { display: block; font-size: 10pt; color: #1f1f1c; }

  h1 { font-family: 'Montserrat', sans-serif; font-size: 13pt; font-weight: 800; text-align: center; letter-spacing: 0.6px; margin: 4px 0 18px; }
  p { text-align: justify; margin-bottom: 8px; }
  .c-intro { margin-bottom: 14px; }
  .c-clause { margin-bottom: 12px; }
  .c-clause h3 { font-family: 'Montserrat', sans-serif; font-size: 9.5pt; font-weight: 700; margin-bottom: 5px; text-transform: uppercase; break-after: avoid; }
  .c-clause h3 span { color: #68761f; }
  .c-list { margin: 0 0 8px 18px; }
  .c-list li { text-align: justify; margin-bottom: 3px; }
  /* Las tablas de cronograma y cuentas nunca se parten entre dos hojas. */
  .c-table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 9.5pt; break-inside: avoid; }
  .c-table th, .c-table td { border: 1px solid #c9c8bd; padding: 5px 8px; text-align: left; vertical-align: top; }
  .c-table th { background: #f1f0e8; font-family: 'Montserrat', sans-serif; font-size: 8.5pt; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.3px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c-closing { margin-top: 16px; }
  /* El cierre y las firmas van juntos: las firmas nunca quedan solas en una hoja. */
  .c-signoff { break-inside: avoid; }

  .c-signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 28mm; margin-top: 10mm; break-inside: avoid; }
  .c-sign { text-align: center; font-size: 9.5pt; }
  /* Mismo alto en ambas columnas para que las líneas de firma queden alineadas. */
  .c-sign-area { height: 30mm; display: flex; align-items: flex-end; justify-content: center; }
  /* multiply: si la imagen trae fondo blanco, se funde con el papel y la marca de agua. */
  .c-sign-area img { max-width: 100%; max-height: 30mm; margin-bottom: 1.5mm; mix-blend-mode: multiply;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c-sign i { display: block; border-top: 1px solid #1f1f1c; margin-bottom: 6px; }
  .c-sign b { display: block; font-family: 'Montserrat', sans-serif; font-size: 9pt; }

  .c-printbar { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 12px; font-family: 'Montserrat', sans-serif; }
  .c-printbar button { background: #8a9b30; color: #fff; border: none; padding: 11px 26px; font: 700 13px 'Montserrat', sans-serif; border-radius: 8px; cursor: pointer; }
  .c-printbar button:hover { background: #68761f; }
  .c-printbar span { font-size: 11px; color: #4b4b44; }

  @page { size: A4; margin: 22mm 20mm 20mm; }
  @media print {
    body { background: #fff; }
    .c-noprint { display: none !important; }
    .c-sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
    .c-head { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @media screen and (max-width: 840px) {
    .c-sheet { width: 100%; min-height: 0; padding: 16px; }
  }
</style>
</head>
<body>
<div class="c-printbar c-noprint">
  <button type="button" onclick="window.print()">Imprimir / Guardar como PDF</button>
  <span>En el diálogo elige “Guardar como PDF”, tamaño A4 y desactiva “Encabezados y pies de página”.</span>
</div>
<article class="c-sheet">
  ${watermark ? `<div class="c-watermark" aria-hidden="true">${watermark}</div>` : ''}
  <div class="c-content">
    <header class="c-head">
      <div class="c-brand">
        ${BRAND_LOGO
          ? `<img class="c-logo" src="${BRAND_LOGO}" alt="Avantage Group">`
          : `<svg viewBox="0 0 70 58" aria-hidden="true">${agMarkPaths()}</svg>`}
        <div><small>${esc(COMPANY.legalName)} · RUC ${esc(COMPANY.ruc)}</small></div>
      </div>
      <div class="c-number">Contrato<b>${esc(number)}</b></div>
    </header>

    <h1>${esc(contract.title || 'CONTRATO')}</h1>
    ${contract.intro ? `<div class="c-intro">${paragraphs(contract.intro, values, contract)}</div>` : ''}
    ${clauses}
    <div class="c-signoff">
      ${contract.closing ? `<div class="c-closing">${paragraphs(contract.closing, values, contract)}</div>` : ''}
      <div class="c-signatures">
        <div class="c-sign"><div class="c-sign-area">${showSignature ? `<img src="${LESSOR_SIGNATURE}" alt="Firma y sello de EL LOCADOR">` : ''}</div><i></i><b>EL LOCADOR</b>${lessorCaption}</div>
        <div class="c-sign"><div class="c-sign-area"></div><i></i><b>EL CLIENTE</b>${esc(contract.client_name || BLANK)}<br>DNI ${esc(contract.client_dni || BLANK)}</div>
      </div>
    </div>
  </div>
</article>
</body>
</html>`;
}
