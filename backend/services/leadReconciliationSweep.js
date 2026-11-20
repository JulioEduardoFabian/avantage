/**
 * El barrido que corre solo las dos conciliaciones de leads, una vez al día.
 *
 * Las dos ya existían y las dos dependían de que alguien se acordara de
 * apretar un botón: la de **Meta** (`metaLeadReconciliationService`), que le
 * pregunta a la Graph API qué leads tiene cada formulario y recupera los que
 * el webhook nunca llegó a procesar, y la de **TikTok**
 * (`tiktokLeadsService`), que es la única forma de que un lead de TikTok entre
 * al CRM porque ahí no hay webhook en absoluto.
 *
 * Que dependan de un botón es el agujero: en septiembre de 2026 se perdió así
 * el 39% de los leads de formulario de Meta (95 en el Administrador de
 * anuncios contra 58 en la base), y nadie se enteró hasta que marketing cruzó
 * las dos planillas semanas después. Un lead perdido no falla: simplemente no
 * está, y encima Meta solo conserva los leads de un formulario **90 días**,
 * así que lo que no se concilia dentro de ese plazo se perdió de verdad.
 *
 * Tres decisiones:
 *
 *  - **Importa, no solo reporta.** Un barrido que dejara el informe para que
 *    alguien lo mire es el mismo botón con otra forma. Las dos importaciones
 *    son idempotentes (cruzan por el id del lead en la plataforma y por
 *    teléfono antes de crear nada), así que correrlas de nuevo no duplica a
 *    nadie.
 *
 *  - **Mira una ventana de varios días y no solo el día de ayer.** Un lead
 *    puede llegar tarde, y el día que el barrido falle —o que el proceso esté
 *    caído— la ventana del día siguiente lo vuelve a cubrir. Con un solo día,
 *    un barrido que no corrió es un lead que ya nadie va a buscar.
 *
 *  - **El fallo de una plataforma no detiene la otra.** Son dos APIs distintas
 *    con dos tokens distintos, y el permiso de Lead Generation de TikTok se
 *    cae solo (hay que reautorizar la app); dejar a Meta sin conciliar por eso
 *    sería sumar una pérdida a la otra.
 *
 * No tiene pantalla: lo que recupera se ve en el funnel como cualquier lead, y
 * el resumen de cada corrida queda en el log del servidor. El botón de cada
 * conciliación sigue existiendo para cuando hay que mirar el detalle ahora
 * mismo.
 *
 * Desde el 09/11/2026 el barrido tiene una **tercera pata, y con otra
 * cadencia**: las conversaciones de WhatsApp que quedaron sin ficha
 * (`orphanConversationService`). Guardar el mensaje entrante y abrir la ficha
 * son dos escrituras del mismo webhook, que ya respondió 200 — si la segunda
 * falla no se reintenta nunca, y lo que queda es una persona que escribió, a la
 * que el bot hasta le contestó, y que no figura en ningún tablero. Era lo mismo
 * que el botón de las otras dos conciliaciones: existía el script para
 * recuperarlas y dependía de que alguien lo corriera, así que las fichas
 * aparecían recién cuando alguien buscaba a mano a UN contacto que no
 * encontraba (02/11/2026, ocho conversaciones; 09/11/2026, otra más).
 *
 * Esa pata corre en **cada vuelta del temporizador** y no una vez al día: un
 * contacto que escribe y no tiene ficha no lo ve el setter, así que esperar
 * hasta las 7 de la mañana siguiente es perder el día en que escribió. Puede
 * correr seguido porque no le pregunta nada a ninguna API de afuera —son dos
 * consultas a nuestra propia base— y porque adoptar es idempotente:
 * `findOrCreateFromWhatsApp()` cruza por teléfono antes de crear nada.
 */

/** Cada cuánto se revisa si ya toca correr (el barrido decide solo si corre). */
export const SWEEP_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Ventana de la pata frecuente de conversaciones huérfanas.
 *
 * Corta y no la de 30 días del repaso diario porque esta corre cada diez
 * minutos: con dos días, cualquier conversación que se haya quedado sin ficha
 * se recupera dentro de los diez minutos y se la sigue reintentando por dos
 * días más, que es lo que cubre un proceso que estuvo caído un rato. Lo más
 * viejo que eso lo barre la corrida diaria, que mira el mes entero.
 */
export const ORPHAN_FREQUENT_DAYS = 2;

/** Ventana del repaso diario de conversaciones huérfanas. */
export const ORPHAN_DAILY_DAYS = 30;

const TZ = 'America/Lima';

/** El día de Lima ("2026-11-01") de un instante, que es el que ordena todo. */
export function limaDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

/** La hora de Lima (0-23) de un instante. */
export function limaHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hour: '2-digit', hourCycle: 'h23'
  }).format(date));
}

/** El día de Lima de hace `days` días, en el formato que piden las dos APIs. */
export function dayKeyBefore(days, date = new Date()) {
  return limaDayKey(new Date(date.getTime() - days * 24 * 60 * 60 * 1000));
}

export class LeadReconciliationSweep {
  /**
   * @param {object} deps
   * @param {object} deps.metaReconciliation servicio de conciliación de Meta
   * @param {object} deps.tiktokLeads        importación de leads de TikTok
   * @param {object} [deps.whatsappOrphans]  `{ find, adopt }` de conversaciones sin ficha
   * @param {number} [deps.hour]             hora de Lima a la que corre
   * @param {number} [deps.days]             días hacia atrás que revisa
   */
  constructor({ metaReconciliation, tiktokLeads, whatsappOrphans = null, hour = null, days = null } = {}) {
    this.meta = metaReconciliation || null;
    this.tiktok = tiktokLeads || null;
    /*
     * `{ find, adopt }` y no el servicio entero: el barrido es orquestación y
     * no toca la base, que es lo que permite probarlo con dos funciones falsas
     * igual que las otras dos conciliaciones.
     */
    this.orphans = whatsappOrphans || null;
    this.recoveringOrphans = false;
    this.hour = Number.isFinite(Number(hour)) ? Number(hour) : 7;
    this.days = Number.isFinite(Number(days)) ? Number(days) : 3;
    /*
     * El día en que ya corrió, en memoria. No se guarda en la base a
     * propósito: lo peor que puede pasar si el proceso se reinicia es que el
     * barrido corra dos veces el mismo día, y las dos importaciones son
     * idempotentes. Una tabla para eso sería un esquema más que mantener para
     * evitar algo que no hace daño.
     */
    this.lastRunDay = null;
    this.running = false;
  }

  /**
   * Una vuelta del temporizador: lo que corre siempre y lo que corre si toca.
   *
   * Que las dos cadencias vivan acá y no repartidas en el `setInterval` de
   * `server.js` es lo que permite verificarlas: quien llama no tiene que saber
   * cuál de las tres patas corre ahora.
   */
  async tick(now = new Date()) {
    const orphans = await this.recoverOrphanConversations(ORPHAN_FREQUENT_DAYS);
    const daily = await this.runIfDue(now);
    return { orphans, daily };
  }

  /**
   * El repaso de arranque: el mes entero de conversaciones sin ficha, una vez,
   * apenas levanta el proceso.
   *
   * Hacen falta las dos cosas que no da el temporizador. La primera vuelta de
   * `setInterval` llega recién a los **diez minutos**, así que sin esto un
   * despliegue hecho para recuperar un contacto no recupera nada hasta la
   * vuelta siguiente — y lo que se acaba de desplegar se juzga en ese rato. Y
   * la pata frecuente mira **dos días**: todo lo que se quedó sin ficha antes
   * de eso esperaría hasta las 07:00 del día siguiente, que es justo el atraso
   * acumulado que un despliegue viene a saldar.
   *
   * Es el mismo sondeo inicial que ya hace `pageFollowerService` al arrancar, y
   * por la misma razón.
   */
  async catchUpOnStart() {
    const resumen = await this.recoverOrphanConversations(ORPHAN_DAILY_DAYS);
    if (resumen?.huerfanas || resumen?.borradas) {
      console.log(`🩹 [Conversaciones sin ficha] Repaso de arranque (${ORPHAN_DAILY_DAYS} días): `
        + `${resumen.huerfanas} sin ficha, ${resumen.adoptadas} adoptadas, `
        + `${resumen.borradas} con la ficha borrada a mano.`);
    }
    return resumen;
  }

  /**
   * Abre la ficha que le falta a cada conversación de WhatsApp de la ventana.
   *
   * Tres cuidados: **no se solapa consigo misma** (la vuelta anterior puede
   * seguir adoptando), el fallo de UNA conversación no detiene a las demás
   * —casi siempre es el dato de esa ficha y no el camino de alta—, y el
   * silencio es silencio: cuando no hay nada que recuperar no escribe una
   * línea, porque un log que dice "0 huérfanas" cada diez minutos es un log que
   * nadie vuelve a leer.
   */
  async recoverOrphanConversations(days = ORPHAN_FREQUENT_DAYS) {
    if (!this.orphans || this.recoveringOrphans) return null;

    this.recoveringOrphans = true;
    const resumen = { revisadas: 0, huerfanas: 0, adoptadas: 0, borradas: 0, errores: [] };
    try {
      const { total, orphans, borradas } = await this.orphans.find({ days });
      resumen.revisadas = total || 0;
      resumen.huerfanas = orphans.length;
      // Las que no se adoptan porque alguien borró su ficha a propósito. Van
      // en el resumen y no descartadas en silencio: es la respuesta a "esta
      // conversación sigue sin ficha y el barrido dice que no hay nada".
      resumen.borradas = borradas || 0;

      for (const orphan of orphans) {
        try {
          await this.orphans.adopt(orphan);
          resumen.adoptadas += 1;
          console.log(`🩹 [Conversaciones sin ficha] Ficha abierta para ${orphan.waId}`
            + `${orphan.contactName ? ` (${orphan.contactName})` : ''}, `
            + `${orphan.messages} mensaje(s) desde ${orphan.firstAt}.`);
        } catch (error) {
          resumen.errores.push({ waId: orphan.waId, error: error.message });
          console.error(`❌ [Conversaciones sin ficha] No se pudo abrir la ficha de ${orphan.waId}:`, error.message);
        }
      }
    } catch (error) {
      resumen.errores.push({ waId: null, error: error.message });
      console.error('❌ [Conversaciones sin ficha] Error al buscar conversaciones sin ficha:', error.message);
    } finally {
      this.recoveringOrphans = false;
    }

    return resumen;
  }

  /** ¿Ya es la hora y todavía no corrió hoy? */
  isDue(now = new Date()) {
    if (this.running) return false;
    if (limaHour(now) < this.hour) return false;
    return this.lastRunDay !== limaDayKey(now);
  }

  /**
   * Corre el barrido si toca. Devuelve el resumen, o `null` si no era la hora
   * — así quien lo llama desde el temporizador no tiene que saber la regla.
   */
  async runIfDue(now = new Date()) {
    if (!this.isDue(now)) return null;
    return this.run(now);
  }

  /**
   * Las dos conciliaciones, cada una con su error contenido.
   *
   * El día se marca como corrido ANTES de empezar y no al terminar: si una de
   * las dos plataformas falla, el barrido no tiene que reintentar en bucle
   * cada diez minutos contra una API que está rechazando el token — la ventana
   * de varios días es la que cubre el día perdido.
   */
  async run(now = new Date()) {
    this.running = true;
    this.lastRunDay = limaDayKey(now);

    const since = dayKeyBefore(this.days, now);
    const until = limaDayKey(now);
    const resumen = {
      dia: until,
      ventana: { since, until },
      meta: null,
      tiktok: null,
      huerfanas: null,
      errores: []
    };

    try {
      /*
       * El repaso del mes de conversaciones sin ficha. La pata frecuente ya
       * cubre lo de los últimos dos días; esta es la red para lo que quedó
       * atrás —el proceso caído un fin de semana, o una ficha borrada a mano
       * que dejó su conversación suelta—, y es la misma razón por la que las
       * dos conciliaciones miran varios días y no solo el de ayer.
       */
      resumen.huerfanas = await this.recoverOrphanConversations(ORPHAN_DAILY_DAYS);
      if (resumen.huerfanas?.huerfanas) {
        console.log(`🔄 [Conciliación diaria] Conversaciones sin ficha (${ORPHAN_DAILY_DAYS} días): `
          + `${resumen.huerfanas.huerfanas} encontradas, ${resumen.huerfanas.adoptadas} adoptadas.`);
      }

      if (this.meta) {
        try {
          const report = await this.meta.reconcile({ since, until, apply: true });
          resumen.meta = {
            en_meta: report.totals.en_meta,
            en_crm: report.totals.en_crm,
            faltantes: report.totals.faltantes,
            cajones: report.totals.cajones,
            importados: report.totals.importados,
            // Un "adjuntado" es la misma persona que ya era lead: es el
            // duplicado que explica por qué el CRM cuenta menos que Meta.
            adjuntados: report.totals.adjuntados,
            sin_anuncio: report.totals.sin_anuncio,
            suscripcion: report.suscripcion?.estado || null
          };
          console.log(`🔄 [Conciliación diaria] Meta ${since} → ${until}: ${report.totals.en_meta} en Meta, `
            + `${report.totals.en_crm} ya en el CRM, ${report.totals.importados} importados, `
            + `${report.totals.adjuntados} adjuntados a fichas existentes.`);
          if (report.suscripcion?.estado && report.suscripcion.estado !== 'conectado') {
            // Sin el campo `leadgen` suscrito, Meta no llama al webhook y
            // nadie se enteraría: es la causa más silenciosa de leads
            // perdidos, así que se dice en cada corrida y no una vez.
            console.warn(`⚠️ [Conciliación diaria] La página NO está recibiendo leads por webhook `
              + `(${report.suscripcion.estado}): hoy los leads entran solo por este barrido.`);
          }
        } catch (error) {
          resumen.errores.push({ plataforma: 'meta', error: error.message });
          console.error('❌ [Conciliación diaria] Meta:', error.message);
        }
      }

      if (this.tiktok) {
        try {
          const report = await this.tiktok.run({ from: since, to: until, apply: true });
          resumen.tiktok = {
            en_tiktok: report.totals.en_tiktok,
            en_crm: report.totals.en_crm,
            faltantes: report.totals.faltantes,
            importados: report.totals.importados,
            adjuntados: report.totals.adjuntados,
            completados: report.totals.completados,
            // Envíos que quedaron sin atribuir porque el teléfono era la única
            // evidencia. No son errores y no se cuentan como tales: son casos
            // que esperan que una persona los resuelva.
            pendientes: report.totals.pendientes,
            // Los cinco cajones del corte: sin ellos, una diferencia nunca se
            // termina de explicar y la alarma que deja no se puede cerrar.
            cajones: report.totals.cajones,
            sin_anuncio: report.totals.sin_anuncio
          };
          console.log(`🔄 [Conciliación diaria] TikTok ${since} → ${until}: ${report.totals.en_tiktok} en TikTok, `
            + `${report.totals.importados} importados, ${report.totals.adjuntados} adjuntados, `
            + `${report.totals.completados} fichas completadas, `
            + `${report.totals.pendientes} pendientes de resolución.`);
        } catch (error) {
          resumen.errores.push({ plataforma: 'tiktok', error: error.message });
          console.error('❌ [Conciliación diaria] TikTok:', error.message);
        }
      }
    } finally {
      this.running = false;
    }

    return resumen;
  }
}
