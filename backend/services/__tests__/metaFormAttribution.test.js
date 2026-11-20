import test from 'node:test';
import assert from 'node:assert/strict';

import { dedupeAttribution, formContactsFromLeads } from '../campaignService.js';

/*
 * Los leads de los formularios instantáneos de Meta entraban al CRM con su
 * `meta_ad_id` guardado desde el webhook, pero la atribución de Campañas solo
 * miraba el `referral` de WhatsApp: un lead de formulario —que es la mayoría de
 * lo que entra— no figuraba en ninguna hoja, así que el reporte por anuncio
 * contaba la mitad de los leads y la mitad del dinero de cada anuncio. Lo que
 * sigue fija las dos reglas de esa mitad nueva.
 */

const LEAD_FORMULARIO = {
  id: 501,
  phone: '+51 987 654 321',
  full_name: 'Lucía Quispe',
  meta_ad_id: '120210000000123456',
  meta_form_id: '900100200300400',
  meta_platform: 'fb',
  meta_created_time: '2026-10-25T14:03:00.000Z',
  created_at: '2026-10-28T09:00:00.000Z'
};

test('el ad_id del formulario viaja en el mismo "ID de origen" que el referral', () => {
  const [contacto] = formContactsFromLeads([LEAD_FORMULARIO]);
  assert.equal(contacto.sourceId, '120210000000123456');
  assert.equal(contacto.origin, 'form');
  assert.equal(contacto.leadId, 501);
  assert.equal(contacto.formId, '900100200300400');
});

test('la fecha es la del envío en Meta, no la del día en que entró al CRM', () => {
  // Un lead que la conciliación rescató tres días después pertenece al día en
  // que la persona llenó el formulario: con `created_at` el cruce contra el
  // Administrador de anuncios no cerraría nunca.
  const [contacto] = formContactsFromLeads([LEAD_FORMULARIO]);
  assert.equal(contacto.firstMessageAt, '2026-10-25T14:03:00.000Z');
});

test('sin meta_created_time se cae a la fecha de alta en vez de quedar sin ubicar', () => {
  const [contacto] = formContactsFromLeads([{ ...LEAD_FORMULARIO, meta_created_time: null }]);
  assert.equal(contacto.firstMessageAt, '2026-10-28T09:00:00.000Z');
});

test('la plataforma se traduce al vocabulario del reporte', () => {
  const [fb] = formContactsFromLeads([LEAD_FORMULARIO]);
  const [ig] = formContactsFromLeads([{ ...LEAD_FORMULARIO, meta_platform: 'ig' }]);
  const [sin] = formContactsFromLeads([{ ...LEAD_FORMULARIO, meta_platform: null }]);
  assert.equal(fb.platform, 'facebook');
  assert.equal(ig.platform, 'instagram');
  assert.equal(sin.platform, 'meta');
});

test('si esa persona después escribió por WhatsApp, se le engancha su conversación', () => {
  // El formulario guarda "+51 987 654 321" y el webhook de WhatsApp
  // "51987654321": son el mismo contacto, y sin el cruce por los últimos 9
  // dígitos un lead al que el equipo sí atendió se lee como uno sin responder.
  const indice = new Map([['987654321', '51987654321']]);
  const [contacto] = formContactsFromLeads([LEAD_FORMULARIO], indice);
  assert.equal(contacto.waId, '51987654321');
});

test('un formulario sin conversación no inventa un wa_id', () => {
  const [contacto] = formContactsFromLeads([LEAD_FORMULARIO], new Map());
  assert.equal(contacto.waId, null);
  assert.equal(contacto.phone, '+51 987 654 321');
});

test('un formulario sin celular entra igual, desduplicado por su id', () => {
  // Pasa de verdad (el webhook lo deja avisado en el log): sin esto, el lead
  // que llegó incompleto era además el que desaparecía del reporte.
  const [contacto] = formContactsFromLeads([{ ...LEAD_FORMULARIO, phone: null }]);
  assert.equal(contacto.matchKey, null);
  assert.equal(contacto.dedupeKey, 'lead:501');
});

test('un lead sin ad_id no se atribuye a ningún anuncio', () => {
  // El del evaluador público o el cargado a mano: no hay anuncio al que
  // acreditarle nada.
  assert.deepEqual(formContactsFromLeads([{ ...LEAD_FORMULARIO, meta_ad_id: null }]), []);
});

test('la misma persona por los dos caminos es UN contacto, y gana el de WhatsApp', () => {
  // Hizo clic en un anuncio Click-to-WhatsApp y además llenó un formulario.
  // Contarla dos veces infla las conversaciones atribuidas y abarata el costo
  // por lead; gana WhatsApp porque es el que tiene la conversación detrás.
  const whatsapp = [{
    origin: 'whatsapp',
    waId: '51987654321',
    matchKey: '987654321',
    dedupeKey: '987654321',
    sourceId: '120299999999999999'
  }];
  const forms = formContactsFromLeads([LEAD_FORMULARIO]);

  const lista = dedupeAttribution(whatsapp, forms);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].origin, 'whatsapp');
  assert.equal(lista[0].sourceId, '120299999999999999');
});

test('dos personas distintas siguen siendo dos contactos', () => {
  const whatsapp = [{ origin: 'whatsapp', waId: '51900000000', matchKey: '900000000', dedupeKey: '900000000' }];
  const forms = formContactsFromLeads([LEAD_FORMULARIO]);
  assert.equal(dedupeAttribution(whatsapp, forms).length, 2);
});

test('un wa_id que no es un teléfono se desduplica por sí mismo', () => {
  /*
   * Hay conversaciones cuyo identificador es un id de usuario de la empresa
   * (`PE.2379096279586501`) y no un número: cruzarlas por sus últimos dígitos
   * emparejaría contactos distintos, así que no comparten clave con nadie.
   */
  const whatsapp = [
    { origin: 'whatsapp', waId: 'PE.2379096279586501', matchKey: null, dedupeKey: 'wa:PE.2379096279586501' },
    { origin: 'whatsapp', waId: 'PE.2379096279586502', matchKey: null, dedupeKey: 'wa:PE.2379096279586502' }
  ];
  assert.equal(dedupeAttribution(whatsapp, []).length, 2);
});
