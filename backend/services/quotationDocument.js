/**
 * Generador del documento de cotización con la identidad de marca de
 * Avantage Group (oliva/carbón, tipografía geométrica y monograma "AG").
 *
 * El mismo HTML se usa para:
 *   - la vista imprimible que abre el botón "Generar Cotización" del Funnel
 *   - el cuerpo del correo que se envía al lead
 *
 * El lienzo mide 194 mm (A4 menos 8 mm de margen por lado). Ese margen
 * evita que las bandas oscuras se recorten en impresoras de inyección, que
 * casi nunca imprimen a sangre completa.
 */

import { readFileSync } from 'fs';

/* Datos fijos de la empresa (tomados de la plantilla oficial de cotización). */
export const COMPANY = {
  legalName: 'Avantage Group S.A.C.',
  brandName: 'Avantage Group',
  ruc: '20615846971',
  address: 'Calle Neptuno 185',
  addressCity: 'Huancayo, Huancayo - Perú',
  phone: '+51 972566937',
  email: 'avantage@avantagegroup.com',
  website: 'www.grupoavantage.com',
  tagline: 'INNOVACIÓN · INVESTIGACIÓN · SOFTWARE · MARKETING'
};

/**
 * `holder` es el titular de la cuenta y NO siempre es la empresa: la de
 * Interbank está a nombre del gerente general, no de Avantage Group S.A.C.
 * Antes el contrato imprimía `COMPANY.legalName` para las dos por igual, así
 * que la tabla de cuentas decía que la de Interbank era de la empresa.
 *
 * Solo lo usa la tabla de cuentas del contrato: la cotización imprime el
 * número y el CCI sin titular.
 */
export const PAYMENT_METHODS = [
  {
    bank: 'Banco de Crédito del Perú',
    short: 'BCP',
    accent: '#c0392b',
    holder: 'Avantage Group S.A.C.',
    account: 'Cuenta Corriente (S/): 3557413863061',
    cci: 'CCI: 002 335 007413863061 66'
  },
  {
    bank: 'INTERBANK Perú',
    short: 'Interbank',
    accent: '#0aa05a',
    holder: 'Julio Fabián Ninamango — Gerente General',
    account: 'Cuenta Corriente (S/): 8983515374983',
    cci: 'CCI: 00389801351537498347'
  },
  {
    bank: 'Banco de Crédito del Perú',
    short: 'BCP',
    accent: '#0aa05a',
    holder: 'Christian Janampa García — Gerente Financiero',
    account: 'Cuenta Corriente (S/): 35519829450083',
    cci: 'CCI: 00235511982945008361'
  }
];

/* Paleta de marca */
const C = {
  ink: '#1f1f1c',
  inkFoot: '#1b1b18',
  olive: '#8a9b30',
  oliveDeep: '#68761f',
  olivePale: '#cbd69a',
  sand: '#ece9dc',
  paper: '#f7f6ef',
  rule: '#dcdac9',
  muted: '#5d5e51',
  brick: '#b23a2c'
};

/**
 * Símbolo "AG" oficial, embebido como data URI: la cotización se manda por
 * correo y se imprime desde el navegador, así que no puede referenciar un
 * archivo servido aparte.
 *
 * Es solo el símbolo, sin la palabra "AVANTAGE": el encabezado ya compone el
 * nombre con texto propio (en blanco sobre el fondo oscuro), y el logo
 * completo lo duplicaría — además de que su palabra en olivo no se leería
 * sobre casi negro. El logo entero vive en logo-avantage.png y lo usa el
 * contrato, que va sobre papel blanco.
 *
 * Si el archivo falta, se sigue dibujando la marca vectorial de respaldo.
 */
/**
 * Ruta e identificador del símbolo para el envío por CORREO.
 *
 * En el correo no sirve el data URI: Gmail y varios clientes bloquean las
 * imágenes `data:` (igual que estiraban el `<svg>` inline que había antes, que
 * tampoco llegaba a verse). Lo que sí renderizan es una imagen adjunta
 * referenciada por `cid:`, así que el mismo PNG se manda adjunto y el
 * documento lo apunta por ese identificador. Ver `sendQuoteEmail`.
 */
export const BRAND_MARK_CID = 'avantage-mark';
export const BRAND_MARK_PATH = new URL('../assets/logo-avantage-mark.png', import.meta.url);

const BRAND_MARK = (() => {
  try {
    const png = readFileSync(BRAND_MARK_PATH);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    console.warn('⚠️ [Cotizaciones] No se encontró backend/assets/logo-avantage-mark.png: se usará la marca vectorial de respaldo.');
    return null;
  }
})();

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatQuoteNumber(quote) {
  const year = new Date(quote.created_at || Date.now()).getFullYear();
  return `CTZ-${year}-${String(quote.id).padStart(4, '0')}`;
}

function formatLongDate(value) {
  if (!value) return '—';
  // Una fecha "YYYY-MM-DD" la interpreta `new Date` como medianoche UTC, que
  // en Perú (UTC-5) cae el día anterior: el papel decía un día menos que la
  // fila de Finanzas. Se arma en horario local.
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
  const date = value instanceof Date
    ? value
    : (dateOnly
      ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
      : new Date(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatMoney(amount, currency) {
  const symbol = currency === 'USD' ? 'US$' : 'S/';
  const number = Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${symbol} ${number}`;
}

/**
 * Cada línea del alcance es un entregable. El texto antes de los dos puntos es
 * su nombre (va en negrita en el documento, como en la cotización que usa el
 * equipo) y el resto es la descripción; una línea sin dos puntos se imprime
 * tal cual.
 */
function parseScopeItems(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•*+\-–✓]+/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':');
      if (separator <= 0) return { label: '', text: line };
      return { label: line.slice(0, separator).trim(), text: line.slice(separator + 1).trim() };
    });
}

/** Condiciones comerciales: una por línea, ya numeradas por el documento. */
function parseTerms(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•*+\-–]*\d*[.)]?\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Textos por defecto del documento: una cotización vieja —o una emitida sin
 * llenar los campos nuevos— se sigue imprimiendo completa.
 */
const DEFAULTS = {
  estimatedTime: 'Según cronograma acordado',
  statusLabel: 'Propuesta vigente',
  serviceSubtitle: 'Acompañamiento, tutoría y correcciones continuas hasta la aprobación formal.',
  warrantyText: 'El servicio asegura acompañamiento constante y revisiones adaptadas a las exigencias y rúbricas de la universidad hasta la aprobación formal de la tesis.',
  commercialTerms: [
    'Los entregables y avances se programarán según el cronograma acordado en el contrato de servicio.',
    'Esta cotización formaliza el alcance de la tesis terminada con las herramientas mencionadas, sin costos adicionales.',
    'Validez de la propuesta económica sujeta a confirmación antes de la fecha de vigencia indicada.'
  ]
};

/* ── Iconografía de línea (16×16, trazo `currentColor`) ─────────────────── */
const ICONS = {
  user: '<circle cx="8" cy="5.4" r="3"/><path d="M2.6 14c0-3 2.4-5 5.4-5s5.4 2 5.4 5"/>',
  career: '<rect x="2" y="5" width="12" height="8" rx="1.2"/><path d="M6 5V3.6h4V5"/><path d="M2 8.6h12"/>',
  mail: '<rect x="2" y="3.6" width="12" height="8.8" rx="1.2"/><path d="m2.6 4.6 5.4 4 5.4-4"/>',
  phone: '<path d="M4.2 2.5 6 5.6 4.6 7.2c.9 1.8 2.4 3.3 4.2 4.2l1.6-1.4 3.1 1.8c-.1 1.4-1.1 2.4-2.6 2.4C6.5 14.2 1.8 9.5 1.8 3.7 1.8 2.2 2.8 1.2 4.2 1.1c.4 0 .8.4 1 1z"/>',
  calendar: '<rect x="2" y="3" width="12" height="11" rx="1.2"/><path d="M2 6.4h12M5.4 1.8v2.6M10.6 1.8v2.6"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.6 1.6"/>',
  card: '<rect x="1.5" y="4" width="13" height="8" rx="1.2"/><path d="M1.5 6.9h13"/>',
  shield: '<path d="M8 1.5 13 3.4V8c0 3.5-2.5 5.6-5 6.6C5.5 13.6 3 11.5 3 8V3.4z"/><path d="m5.9 8 1.5 1.6L10.3 6"/>',
  doc: '<path d="M4 1.6h5l3 3v9.8H4z"/><path d="M9 1.6v3h3"/><path d="M6 8h4M6 10.4h4"/>'
};

function icon(name, cls = 'q-ic') {
  return `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ── Monograma "AG": "A" facetada en dos planos + curva "G" entrelazada ── */
export function agMarkPaths({ mono = false } = {}) {
  const planeA = C.olive;
  const planeB = mono ? C.olive : C.oliveDeep;
  const arc = mono ? C.olive : C.oliveDeep;
  return `
    <path d="M24 5 L42 52 L32 52 L24 29 Z" fill="${planeB}"/>
    <path d="M24 5 L6 52 L16 52 L24 29 Z" fill="${planeA}"/>
    <path d="M15 39 L33 39 L30 32 L18 32 Z" fill="${planeA}"/>
    <circle cx="52" cy="30" r="12" fill="none" stroke="${arc}" stroke-width="5"
      stroke-linecap="round" stroke-dasharray="57 18" stroke-dashoffset="9"/>
    <path d="M53 30 L61 30" fill="none" stroke="${arc}" stroke-width="5" stroke-linecap="round"/>`;
}

function brandLogo({ dark = true, markSrc = null } = {}) {
  const wordColor = dark ? '#ffffff' : C.ink;
  const groupColor = dark ? '#cfcfc6' : C.muted;
  return `
    <div class="q-logo">
      ${markSrc
        ? `<img class="q-logo__mark" src="${markSrc}" alt="Avantage Group">`
        : `<svg class="q-logo__mark" viewBox="0 0 70 58" role="img" aria-label="Avantage Group">${agMarkPaths()}</svg>`}
      <span class="q-logo__text">
        <span class="q-logo__word" style="color:${wordColor}">AVANTAGE</span>
        <span class="q-logo__group">
          <i class="q-logo__rule"></i><span style="color:${groupColor}">GROUP</span><i class="q-logo__rule"></i>
        </span>
        <span class="q-logo__tag">${esc(COMPANY.tagline)}</span>
      </span>
    </div>`;
}

function monogram(cls, markSrc) {
  if (markSrc) return `<img class="${cls}" src="${markSrc}" alt="" aria-hidden="true">`;
  return `<svg class="${cls}" viewBox="0 0 70 58" aria-hidden="true">${agMarkPaths({ mono: true })}</svg>`;
}

/**
 * Piezas de marca compartidas con otros documentos que deben verse como parte
 * de la misma familia (hoy, el comprobante de pago de Finanzas). Se exportan
 * desde acá en vez de duplicarse: la paleta, el logo y la iconografía tienen
 * que cambiar en un solo lugar o los documentos se desalinean entre sí.
 */
export { C as BRAND_COLORS, BRAND_MARK, icon, brandLogo, monogram, formatMoney, formatLongDate };

/**
 * Construye el documento HTML completo de la cotización.
 * @param {object} params
 * @param {object} params.quote  Fila de la tabla `quotes`.
 * @param {object} params.lead   Fila de la tabla `leads` asociada.
 * @param {boolean} [params.forPrint]  Muestra la barra con el botón "Imprimir".
 * @param {boolean} [params.forEmail]  Apunta el símbolo al adjunto `cid:` en
 *   vez de al data URI, que los clientes de correo bloquean.
 */
export function buildQuotationDocument({ quote, lead, forPrint = false, forEmail = false }) {
  const markSrc = forEmail ? `cid:${BRAND_MARK_CID}` : BRAND_MARK;
  const currency = quote.currency || 'PEN';
  const total = Number(quote.amount || 0);
  // El precio de lista solo cuenta si es mayor al acordado: de ahí sale el
  // descuento que se le muestra al cliente.
  const regularAmount = Number(quote.regular_amount || 0) > total ? Number(quote.regular_amount) : 0;

  const scopeItems = parseScopeItems(quote.scope_items);
  const commercialTerms = parseTerms(quote.commercial_terms);
  if (commercialTerms.length === 0) commercialTerms.push(...DEFAULTS.commercialTerms);

  const quoteNumber = quote.code || formatQuoteNumber(quote);
  const issueDate = formatLongDate(quote.created_at || new Date());
  const validUntil = formatLongDate(quote.valid_until);

  const clientName = lead.full_name || lead.email || 'Cliente';
  const career = lead.field_of_study || '—';
  const university = lead.university || '—';
  const conceptTitle = quote.concept_title || 'TESIS COMPLETA';
  const observations = quote.notes ? esc(quote.notes) : '';
  const estimatedTime = quote.estimated_time || DEFAULTS.estimatedTime;
  const statusLabel = quote.status_label || DEFAULTS.statusLabel;
  const serviceSubtitle = quote.service_subtitle || DEFAULTS.serviceSubtitle;
  const warrantyText = quote.warranty_text || DEFAULTS.warrantyText;

  const printBar = forPrint
    ? `<div class="q-printbar q-noprint">
         <button type="button" onclick="window.print()">Imprimir / Guardar como PDF</button>
         <span>Sugerencia: en el diálogo elige “Márgenes: Predeterminados” y desactiva “Encabezados y pies de página”.</span>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cotización ${esc(quoteNumber)} — ${esc(COMPANY.brandName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: ${C.ink};
    --olive: ${C.olive};
    --olive-deep: ${C.oliveDeep};
    --sand: ${C.sand};
    --paper: ${C.paper};
    --rule: ${C.rule};
    --muted: ${C.muted};
  }

  body {
    font-family: 'Montserrat', 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: var(--ink);
    background: #b7b6ac;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .q-sheet {
    width: 194mm;
    min-height: 274mm;
    margin: 20px auto;
    background: var(--paper);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 14px 44px rgba(0,0,0,0.28);
    position: relative;
  }

  /* ─── Encabezado con costura diagonal ─── */
  .q-head { position: relative; display: grid; grid-template-columns: 52% 1fr; background: var(--sand); overflow: hidden; }
  .q-head__brand {
    background: var(--ink);
    padding: 24px 30px 20px;
    clip-path: polygon(0 0, 100% 0, calc(100% - 24px) 100%, 0 100%);
    position: relative;
    z-index: 1;
  }
  .q-head__seam {
    position: absolute;
    top: -10px; bottom: -10px;
    left: 52%;
    width: 30px;
    margin-left: -25px;
    background: var(--olive);
    transform: skewX(-13deg);
    z-index: 2;
  }
  .q-head__meta {
    padding: 22px 26px 20px 38px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 16px;
    position: relative;
    z-index: 1;
  }

  .q-title { display: flex; flex-direction: column; align-items: flex-start; }
  .q-title { width: 100%; align-items: flex-end; text-align: right; }
  .q-title h1 { font-size: 22px; font-weight: 800; letter-spacing: 1.2px; color: var(--olive-deep); line-height: 1.08; }
  .q-title .q-sub { margin-top: 5px; font-size: 8px; font-weight: 600; font-style: italic; letter-spacing: 0.4px; color: var(--muted); }
  .q-title .q-num {
    margin-top: 9px; font-size: 11px; font-weight: 700; letter-spacing: 2px;
    color: var(--olive-deep); padding-bottom: 4px; border-bottom: 2px solid var(--olive);
  }
  .q-facts { display: grid; gap: 10px; }
  .q-fact__k {
    display: flex; align-items: center; gap: 6px;
    font-size: 8.5px; font-weight: 700; letter-spacing: 0.7px; color: var(--ink);
  }
  .q-fact__v { font-size: 9px; color: var(--muted); margin-top: 2px; padding-left: 18px; line-height: 1.3; }
  .q-fact .q-ic { width: 12px; height: 12px; color: var(--olive-deep); flex: none; }

  /* ─── Logo ─── */
  .q-logo { display: flex; align-items: center; gap: 13px; }
  .q-logo__mark { height: 44px; width: auto; flex: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .q-logo__text { display: flex; flex-direction: column; gap: 4px; }
  .q-logo__word { font-size: 21px; font-weight: 700; letter-spacing: 5.5px; line-height: 1; }
  .q-logo__group { display: flex; align-items: center; gap: 7px; font-size: 8px; font-weight: 600; letter-spacing: 3.5px; padding-left: 3px; }
  .q-logo__rule { width: 15px; height: 1px; background: ${C.brick}; display: inline-block; }
  .q-logo__tag { font-size: 5.7px; font-weight: 600; letter-spacing: 0.7px; color: ${C.olivePale}; white-space: nowrap; margin-top: 2px; }

  /* ─── Cuerpo ─── */
  .q-body { flex: 1; padding: 26px 30px 22px; position: relative; }
  .q-watermark {
    position: absolute; right: -14px; top: 40px; width: 230px; height: auto;
    opacity: 0.06; z-index: 0; pointer-events: none;
  }
  .q-body > *:not(.q-watermark) { position: relative; z-index: 1; }

  /* ─── Cabeceras de bloque ─── */
  .q-h {
    display: flex; align-items: center; gap: 7px;
    font-size: 10px; font-weight: 800; letter-spacing: 0.6px; color: var(--olive-deep);
    text-transform: uppercase;
  }
  .q-h .q-ic { width: 14px; height: 14px; }

  /* ─── Datos del cliente + condiciones de la oferta ─── */
  .q-intro { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
  .q-box { border: 1px solid var(--rule); border-left: 3px solid var(--olive); background: #fff; }
  .q-box--offer { border-left-color: ${C.brick}; }
  .q-box--offer .q-h { color: ${C.brick}; }
  .q-box__head { padding: 7px 11px; background: var(--sand); border-bottom: 1px solid var(--rule); }
  .q-box__body { padding: 9px 11px; display: grid; gap: 5px; }
  .q-line { display: flex; gap: 6px; font-size: 9.5px; line-height: 1.45; }
  .q-line dt { font-weight: 700; color: var(--ink); white-space: nowrap; }
  .q-line dt::before { content: "▪"; color: var(--olive-deep); margin-right: 4px; }
  .q-box--offer .q-line dt::before { color: ${C.brick}; }
  .q-line dd { color: var(--muted); }

  /* ─── Servicio y entregables ─── */
  .q-svc { border: 1px solid var(--rule); margin-bottom: 14px; }
  .q-svc__head {
    display: grid; grid-template-columns: 1fr 120px;
    background: var(--ink); color: #fff;
  }
  .q-svc__head span {
    padding: 7px 11px; font-size: 9px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase;
  }
  .q-svc__head span:last-child { background: var(--olive); text-align: center; }
  .q-svc__body { display: grid; grid-template-columns: 1fr 120px; }
  .q-svc__items { padding: 11px 13px; border-right: 1px solid var(--rule); }
  .q-svc__title { font-size: 10.5px; font-weight: 800; color: var(--olive-deep); display: flex; align-items: center; gap: 7px; }
  .q-svc__title .q-ic { width: 15px; height: 15px; flex: none; }
  .q-svc__sub { font-size: 8.8px; color: var(--muted); font-style: italic; margin: 3px 0 9px; padding-left: 22px; }
  .q-svc__list { list-style: none; display: grid; gap: 6px; }
  .q-svc__list li { position: relative; padding-left: 15px; font-size: 9px; line-height: 1.45; color: var(--muted); }
  .q-svc__list li::before { content: "✓"; position: absolute; left: 0; color: var(--olive); font-weight: 800; }
  .q-svc__list strong { color: var(--olive-deep); font-weight: 700; }
  .q-svc__price {
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 800; color: var(--ink); text-align: center; padding: 10px;
  }

  /* ─── Garantía + precios ─── */
  .q-deal { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .q-warranty { border: 1px solid var(--rule); border-left: 3px solid var(--olive); background: #fff; padding: 9px 11px; }
  .q-warranty p { font-size: 8.8px; line-height: 1.55; color: var(--muted); margin-top: 6px; }
  .q-prices { border: 1px solid var(--rule); background: var(--sand); padding: 9px 12px; display: grid; gap: 6px; align-content: center; }
  .q-price { display: flex; justify-content: space-between; gap: 12px; font-size: 9.5px; color: var(--muted); }
  .q-price dt { font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
  .q-price--off dd, .q-price--off dt { color: ${C.brick}; }
  .q-price--final {
    border-top: 1px solid var(--rule); padding-top: 6px; font-size: 12px;
    color: var(--olive-deep); font-weight: 800;
  }
  .q-price--final dd { font-size: 14px; }

  /* ─── Observaciones y condiciones comerciales ─── */
  .q-terms { border: 1px solid var(--rule); padding: 9px 11px; }
  .q-terms ol { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; }
  .q-terms li { font-size: 8.8px; line-height: 1.5; color: var(--muted); }
  .q-obs { margin-top: 10px; font-size: 8.8px; line-height: 1.55; color: var(--muted); }
  .q-obs h4 { font-size: 9px; font-weight: 800; letter-spacing: 0.5px; color: var(--olive-deep); text-transform: uppercase; margin-bottom: 4px; }

  /* ─── Pie ─── */
  .q-foot {
    margin-top: auto; background: ${C.inkFoot}; color: #d6d6ce;
    padding: 24px 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 34px;
    position: relative; overflow: hidden;
  }
  .q-foot::before {
    content: ""; position: absolute; right: -30px; top: -20px; bottom: -20px; width: 90px;
    background: var(--olive); opacity: 0.16; transform: skewX(-13deg);
  }
  .q-foot h6 { font-size: 10px; font-weight: 800; letter-spacing: 1px; color: #fff; margin-bottom: 11px; text-transform: uppercase; }
  .q-foot__list { display: grid; gap: 5px; font-size: 8.7px; line-height: 1.55; position: relative; z-index: 1; }
  .q-foot__list .q-row { display: flex; gap: 7px; align-items: flex-start; }
  .q-foot__list .q-ic { width: 12px; height: 12px; color: ${C.olivePale}; flex: none; margin-top: 1px; }
  .q-foot__list strong { color: #fff; font-weight: 700; }
  .q-pay { margin-bottom: 9px; position: relative; z-index: 1; }
  .q-pay:last-child { margin-bottom: 0; }
  .q-pay__bank { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .q-pay__chip { font-size: 7.5px; font-weight: 800; letter-spacing: 0.5px; color: #fff; padding: 2px 6px; border-radius: 3px; }
  .q-pay__bank span { font-size: 9px; font-weight: 700; color: #fff; }
  .q-pay__line { font-size: 8.5px; color: #cfcfc6; line-height: 1.5; }
  .q-foot-mark { position: absolute; right: 10px; bottom: -14px; width: 132px; height: auto; opacity: 0.1; z-index: 0; }

  /* ─── Barra de impresión (solo pantalla) ─── */
  .q-printbar { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 12px 4px; text-align: center; }
  .q-printbar button {
    background: var(--olive); color: #fff; border: none; padding: 11px 26px; font-size: 13px;
    font-weight: 700; border-radius: 8px; cursor: pointer; font-family: inherit; letter-spacing: 0.3px;
  }
  .q-printbar button:hover { background: var(--olive-deep); }
  .q-printbar span { font-size: 11px; color: #4b4b44; }

  @media print {
    html, body { background: #fff; width: 210mm; }
    .q-noprint { display: none !important; }
    .q-sheet {
      width: 210mm;
      min-height: 296mm;
      margin: 0;
      box-shadow: none;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .q-intro, .q-table, .q-summary, .q-terms, .q-foot { break-inside: avoid; }
    @page { size: A4; margin: 0; }
  }

  @media screen and (max-width: 840px) {
    .q-sheet { width: 100%; min-height: 0; }
  }
</style>
</head>
<body>
${printBar}
<div class="q-sheet">

  <header class="q-head">
    <div class="q-head__brand">${brandLogo({ dark: true, markSrc })}</div>
    <div class="q-head__seam"></div>
    <div class="q-head__meta">
      <div class="q-title">
        <h1>COTIZACIÓN<br>DE SERVICIOS</h1>
        <span class="q-num">CÓDIGO: ${esc(quoteNumber)}</span>
        <span class="q-sub">Propuesta de asesoría integral de tesis</span>
      </div>
    </div>
  </header>

  <div class="q-body">
    ${monogram('q-watermark', markSrc)}

    <div class="q-intro">
      <div class="q-box">
        <div class="q-box__head"><div class="q-h">${icon('user')} Datos del cliente</div></div>
        <dl class="q-box__body">
          <div class="q-line"><dt>Nombre:</dt><dd>${esc(clientName)}</dd></div>
          <div class="q-line"><dt>Teléfono:</dt><dd>${esc(lead.phone || '—')}</dd></div>
          <div class="q-line"><dt>Correo:</dt><dd>${esc(lead.email || '—')}</dd></div>
          <div class="q-line"><dt>Especialidad:</dt><dd>${esc(career)}</dd></div>
          <div class="q-line"><dt>Universidad:</dt><dd>${esc(university)}</dd></div>
        </dl>
      </div>
      <div class="q-box q-box--offer">
        <div class="q-box__head"><div class="q-h">${icon('calendar')} Condiciones de la oferta</div></div>
        <dl class="q-box__body">
          <div class="q-line"><dt>Fecha emisión:</dt><dd>${esc(issueDate)}</dd></div>
          <div class="q-line"><dt>Vigencia oferta:</dt><dd>${esc(validUntil)}</dd></div>
          <div class="q-line"><dt>Tiempo estimado:</dt><dd>${esc(estimatedTime)}</dd></div>
          <div class="q-line"><dt>Estado cotización:</dt><dd>${esc(statusLabel)}</dd></div>
        </dl>
      </div>
    </div>

    <section class="q-svc">
      <div class="q-svc__head">
        <span>Descripción del servicio y entregables incluidos</span>
        <span>Valor oficial</span>
      </div>
      <div class="q-svc__body">
        <div class="q-svc__items">
          <div class="q-svc__title">${icon('doc')} ${esc(conceptTitle)}</div>
          ${serviceSubtitle ? `<p class="q-svc__sub">${esc(serviceSubtitle)}</p>` : ''}
          <ul class="q-svc__list">
            ${scopeItems.map((item) => `<li>${item.label ? `<strong>${esc(item.label)}:</strong> ` : ''}${esc(item.text)}</li>`).join('')}
          </ul>
        </div>
        <div class="q-svc__price">${formatMoney(regularAmount || total, currency)}</div>
      </div>
    </section>

    <div class="q-deal">
      <div class="q-warranty">
        <div class="q-h">${icon('shield')} Garantía y asesoría continua</div>
        <p>${esc(warrantyText)}</p>
      </div>
      <dl class="q-prices">
        ${regularAmount ? `
          <div class="q-price"><dt>Precio regular</dt><dd>${formatMoney(regularAmount, currency)}</dd></div>
          <div class="q-price q-price--off"><dt>Descuento exclusivo</dt><dd>- ${formatMoney(regularAmount - total, currency)}</dd></div>
        ` : ''}
        <div class="q-price q-price--final"><dt>Precio final acordado</dt><dd>${formatMoney(total, currency)}</dd></div>
      </dl>
    </div>

    <div class="q-terms">
      <div class="q-h">${icon('card')} Condiciones comerciales</div>
      <ol>${commercialTerms.map((term) => `<li>${esc(term)}</li>`).join('')}</ol>
      ${observations ? `<div class="q-obs"><h4>Observaciones</h4>${observations}</div>` : ''}
    </div>
  </div>

  <footer class="q-foot">
    <div>
      <h6>Datos de la empresa</h6>
      <div class="q-foot__list">
        <div class="q-row">${icon('career')}<span><strong>${esc(COMPANY.legalName)}</strong></span></div>
        <div class="q-row">${icon('doc')}<span>RUC: ${esc(COMPANY.ruc)}</span></div>
        <div class="q-row">${icon('user')}<span>${esc(COMPANY.address)}, ${esc(COMPANY.addressCity)}</span></div>
        <div class="q-row">${icon('phone')}<span>${esc(COMPANY.phone)}</span></div>
        <div class="q-row">${icon('mail')}<span>${esc(COMPANY.email)}</span></div>
        <div class="q-row">${icon('career')}<span>${esc(COMPANY.website)}</span></div>
      </div>
    </div>
    <div>
      <h6>Métodos de pago</h6>
      ${PAYMENT_METHODS.map((m) => `
        <div class="q-pay">
          <span class="q-pay__bank">
            <span class="q-pay__chip" style="background:${m.accent}">${esc(m.short)}</span>
            <span>${esc(m.bank)}</span>
          </span>
          <div class="q-pay__line">${esc(m.account)}<br>${esc(m.cci)}</div>
        </div>`).join('')}
    </div>
    ${monogram('q-foot-mark', markSrc)}
  </footer>

</div>
</body>
</html>`;
}
