<template>
  <main class="container-fluid campaigns-page">
    <header class="page-header">
      <div class="page-header-titles">
        <span class="page-eyebrow">Marketing digital · Datos en vivo</span>
        <h2 class="section-heading"><span class="heading-icon">📣</span> Campañas</h2>
        <p class="section-subheading campaigns-subheading">
          Rendimiento real de las campañas de <strong>Meta Ads</strong> y <strong>TikTok Ads</strong>. En
          <strong>Click-to-WhatsApp</strong>, cada contacto que escribe tras tocar un anuncio queda atribuido por el
          <code>referral</code> de Meta y se sigue por el funnel real hasta la cita o el cierre; de TikTok se trae el
          rendimiento publicitario. La inversión de una campaña manual se registra a mano.
        </p>
      </div>
      <div class="campaigns-toolbar">
        <div class="range-tabs">
          <button
            v-for="opt in RANGE_OPTIONS"
            :key="opt.value"
            type="button"
            class="range-tab"
            :class="{ active: rangeDays === opt.value }"
            @click="setRange(opt.value)"
          >{{ opt.label }}</button>
        </div>
        <button
          type="button"
          class="btn-secondary sync-btn"
          :disabled="syncing || (metaStatus && !metaStatus.configured)"
          :title="metaStatus && !metaStatus.configured ? 'Configura las credenciales de Meta Ads primero' : ''"
          @click="syncMeta"
        >{{ syncing ? '↻ Sincronizando…' : '↻ Sincronizar con Meta' }}</button>
        <button
          type="button"
          class="btn-secondary sync-btn sync-btn-tiktok"
          :disabled="syncingTikTok || (tiktokStatus && !tiktokStatus.configured)"
          :title="tiktokStatus && !tiktokStatus.configured ? 'Configura las credenciales de TikTok Ads primero' : ''"
          @click="syncTikTok"
        >{{ syncingTikTok ? '↻ Sincronizando…' : '↻ Sincronizar con TikTok' }}</button>
        <button
          type="button"
          class="btn-secondary sync-btn sync-btn-tiktok"
          :disabled="tiktokStatus && !tiktokStatus.configured"
          :title="tiktokStatus && !tiktokStatus.configured ? 'Configura las credenciales de TikTok Ads primero' : 'Traer al CRM los leads de los formularios instantáneos de TikTok'"
          @click="openTikTokLeads"
        >📥 Leads de TikTok</button>
        <button
          type="button"
          class="btn-secondary export-btn"
          :disabled="exporting || !report || !report.campaigns.length"
          title="Descargar el rendimiento en Excel (.xlsx): atribución anuncio → venta, anuncios, conjuntos y campañas"
          @click="exportExcel"
        >{{ exporting ? '⏳ Generando…' : '⬇ Exportar a Excel' }}</button>
        <button type="button" class="btn-primary new-campaign-btn" @click="openCreateModal">＋ Nueva campaña</button>
      </div>
    </header>

    <!-- Tira compacta de estado de integraciones cuando están conectadas -->
    <div v-if="(metaStatus && metaStatus.configured) || (tiktokStatus && tiktokStatus.configured)" class="connections-strip">
      <span v-if="metaStatus && metaStatus.configured" class="conn-pill conn-pill-meta">
        <span class="conn-dot"></span>
        <strong>Meta Ads</strong>
        <template v-if="metaStatus.accountName"> · {{ metaStatus.accountName }}</template>
        <span class="data-mono">({{ metaStatus.accountId }})</span>
      </span>
      <span v-if="tiktokStatus && tiktokStatus.configured" class="conn-pill conn-pill-tiktok">
        <span class="conn-dot"></span>
        <strong>TikTok Ads</strong>
        <template v-if="tiktokStatus.advertiserName"> · {{ tiktokStatus.advertiserName }}</template>
        <span class="data-mono">({{ tiktokStatus.advertiserId }})</span>
      </span>
    </div>

    <p v-if="metaStatus && !metaStatus.configured" class="state-banner state-hint">
      <template v-if="metaStatus.reason === 'no_token'">
        🔌 No hay ningún token de Meta configurado. Define <code>META_ADS_ACCESS_TOKEN</code> (o
        <code>META_PAGE_ACCESS_TOKEN</code>) en el <code>.env</code>.
      </template>
      <template v-else-if="metaStatus.reason === 'invalid_token'">
        🔑 El token de Meta dejó de ser válido: se cerró la sesión del usuario de Facebook, se cambió la
        contraseña o el token caducó. Genera uno nuevo y actualiza <code>META_ADS_ACCESS_TOKEN</code> en el
        <code>.env</code>. Para que no vuelva a pasar, usa un token de <strong>usuario del sistema</strong>
        (Business Manager → Configuración del negocio → Usuarios del sistema → Generar token, con
        <code>ads_read</code>): esos no dependen de la sesión de nadie.
        <span class="state-detail">{{ metaStatus.error }}</span>
      </template>
      <template v-else-if="metaStatus.reason === 'no_ad_account'">
        🔌 El token de Meta no tiene acceso a ninguna cuenta publicitaria. Agrégale el permiso
        <code>ads_read</code> y asigna el usuario/System User a la cuenta de Meta Ads, o define
        <code>META_ADS_ACCOUNT_ID</code> en el <code>.env</code>.
      </template>
      <template v-else>
        🔌 No se pudo conectar con Meta Ads: {{ metaStatus.error || 'error desconocido' }}.
        Verifica el permiso <code>ads_read</code> del token o define <code>META_ADS_ACCOUNT_ID</code> en el <code>.env</code>.
      </template>
    </p>
    <p v-if="metaStatus && metaStatus.accountDisabled" class="state-banner state-hint">
      ⚠️ Meta reporta la cuenta publicitaria
      <strong>{{ metaStatus.accountStatusLabel || 'no activa' }}</strong>
      <span v-if="metaStatus.accountStatus" class="data-mono">(account_status {{ metaStatus.accountStatus }})</span>.
      El token funciona y lo ya sincronizado se sigue viendo, pero Meta no entrega datos nuevos
      hasta que se regularice en el Administrador de anuncios.
    </p>
    <p v-if="tiktokStatus && !tiktokStatus.configured" class="state-banner state-hint">
      <template v-if="tiktokStatus.reason === 'no_token'">
        🔌 No hay ningún token de TikTok configurado. Completa <code>TIKTOK_APP_ID</code>,
        <code>TIKTOK_APP_SECRET</code> y <code>TIKTOK_ACCESS_TOKEN</code> en el <code>.env</code>
        (el token sale de <code>POST /api/campaigns/tiktok/exchange-code</code>; ver
        <strong>Conectar TikTok Ads</strong> en el README).
      </template>
      <template v-else-if="tiktokStatus.reason === 'invalid_token'">
        🔑 El token de TikTok dejó de ser válido: el anunciante revocó la autorización de la app o el
        token se regeneró. Vuelve a autorizar desde el portal de TikTok y actualiza
        <code>TIKTOK_ACCESS_TOKEN</code> en el <code>.env</code>.
        <span class="state-detail">{{ tiktokStatus.error }}</span>
      </template>
      <template v-else-if="tiktokStatus.reason === 'no_ad_account'">
        🔌 El token de TikTok no tiene acceso a ninguna cuenta publicitaria. Vuelve a autorizar la app
        marcando la cuenta en TikTok Ads Manager, o define <code>TIKTOK_ADVERTISER_ID</code> en el
        <code>.env</code>.
      </template>
      <template v-else-if="tiktokStatus.reason === 'not_configured'">
        🔌 Falta configuración de TikTok: {{ tiktokStatus.error }}
      </template>
      <template v-else>
        🔌 No se pudo conectar con TikTok Ads: {{ tiktokStatus.error || 'error desconocido' }}.
      </template>
    </p>
    <p v-if="tiktokStatus && tiktokStatus.advertiserDisabled" class="state-banner state-hint">
      ⚠️ TikTok reporta la cuenta publicitaria
      <strong>{{ tiktokStatus.advertiserStatusLabel || 'no activa' }}</strong>
      <span v-if="tiktokStatus.advertiserStatus" class="data-mono">({{ tiktokStatus.advertiserStatus }})</span>.
      El token funciona y lo ya sincronizado se sigue viendo, pero TikTok no entrega datos nuevos
      hasta que se regularice en el Ads Manager.
    </p>
    <p v-if="syncMsg" class="state-banner" :class="syncError ? 'state-error' : 'state-ok'">{{ syncMsg }}</p>
    <p v-if="exportMsg" class="state-banner state-error">⚠️ {{ exportMsg }}</p>
    <p v-if="errorMsg" class="state-banner state-error">⚠️ {{ errorMsg }}</p>
    <AppLoader
      v-else-if="loading && !report"
      variant="dashboard"
      icon="📣"
      title="Cargando rendimiento de campañas…"
      subtitle="Consolidando inversión, atribución de mensajes y retorno de ventas."
    />

    <template v-if="report">
      <!-- KPIs Principales (6 indicadores ejecutivos con jerarquía visual) -->
      <section class="kpi-hero-row">
        <div class="kpi-tile kpi-hero is-primary">
          <div class="kpi-top-line">
            <span class="kpi-label">Campañas activas</span>
            <span class="kpi-mini-badge">En curso</span>
          </div>
          <span class="kpi-value">{{ report.kpis.activeCampaigns }}</span>
          <span class="kpi-sub">de {{ report.campaigns.length }} registradas</span>
        </div>

        <div class="kpi-tile kpi-hero is-cyan">
          <div class="kpi-top-line">
            <span class="kpi-label">Conversaciones</span>
            <span class="kpi-mini-badge">{{ num(report.kpis.qualified) }} calif.</span>
          </div>
          <span class="kpi-value">{{ num(report.kpis.totalConversations) }}</span>
          <span class="kpi-sub" v-if="report.kpis.unclassifiedConversations">
            {{ num(report.kpis.unclassifiedConversations) }} sin clasificar
          </span>
          <span class="kpi-sub" v-else>Contactos atribuidos en CRM</span>
        </div>

        <div class="kpi-tile kpi-hero is-amber">
          <div class="kpi-top-line">
            <span class="kpi-label">Citas agendadas</span>
            <span class="kpi-mini-badge">Agenda</span>
          </div>
          <span class="kpi-value">{{ num(report.kpis.appointments) }}</span>
          <span class="kpi-sub">
            Costo/cita: {{ report.kpis.costPerAppointment != null ? money(report.kpis.costPerAppointment) : '—' }}
          </span>
        </div>

        <div class="kpi-tile kpi-hero is-emerald">
          <div class="kpi-top-line">
            <span class="kpi-label">Ventas ganadas</span>
            <span class="kpi-mini-badge">Cierres</span>
          </div>
          <span class="kpi-value">{{ num(report.kpis.won) }}</span>
          <span class="kpi-sub">
            Costo/ganado: {{ report.kpis.costPerWon != null ? money(report.kpis.costPerWon) : '—' }}
          </span>
        </div>

        <div class="kpi-tile kpi-hero is-rose">
          <div class="kpi-top-line">
            <span class="kpi-label">Inversión registrada</span>
            <span class="kpi-mini-badge">Gasto</span>
          </div>
          <span class="kpi-value">{{ money(report.kpis.totalSpend) }}</span>
          <span class="kpi-sub">Meta Ads · TikTok Ads · Manual</span>
        </div>

        <div class="kpi-tile kpi-hero is-emerald">
          <div class="kpi-top-line">
            <span class="kpi-label">Cobrado y verificado</span>
            <span v-if="report.kpis.roas != null" class="kpi-mini-badge is-roas">ROAS {{ report.kpis.roas }}×</span>
          </div>
          <span class="kpi-value">{{ money(report.kpis.totalCollectedRevenue) }}</span>
          <span class="kpi-sub">Ingreso real verificado en caja</span>
        </div>
      </section>

      <!-- Desglose secundario plegable para no saturar la primera vista -->
      <div class="kpi-secondary-wrap">
        <button
          type="button"
          class="kpi-drawer-toggle"
          :class="{ 'is-open': showExtraKpis }"
          @click="showExtraKpis = !showExtraKpis"
        >
          <span>📊 {{ showExtraKpis ? 'Ocultar métricas detalladas de pipeline y alcance publicitario' : 'Ver métricas de pipeline comercial, finanzas y alcance Meta / TikTok' }}</span>
          <span class="kpi-drawer-Chips">
            <span class="kpi-inline-preview">Pipeline: <strong>{{ money(report.kpis.totalQuotedValue) }}</strong></span>
            <span v-if="report.kpis.metaImpressions != null" class="kpi-inline-preview">Impresiones: <strong>{{ num(report.kpis.metaImpressions) }}</strong></span>
            <span class="kpi-drawer-caret">{{ showExtraKpis ? '▴' : '▾' }}</span>
          </span>
        </button>

        <transition name="kpi-expand">
          <section v-if="showExtraKpis" class="kpi-row kpi-secondary-grid">
            <div class="kpi-tile">
              <span class="kpi-label">Valor cotizado (pipeline)</span>
              <span class="kpi-value">{{ money(report.kpis.totalQuotedValue) }}</span>
              <span class="kpi-sub" v-if="report.kpis.quotedToSpend != null">{{ report.kpis.quotedToSpend }}× el gasto</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-label">Registrado en Finanzas</span>
              <span class="kpi-value">{{ money(report.kpis.totalWonRevenue) }}</span>
              <span class="kpi-sub">
                de ventas ganadas<template v-if="report.kpis.totalPactedRevenue">
                  · {{ money(report.kpis.totalPactedRevenue) }} pactado sin cerrar</template>
              </span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-label">Calificados</span>
              <span class="kpi-value">{{ num(report.kpis.qualified) }}</span>
              <span class="kpi-sub">Prospectos aptos</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-label">Costo por cita</span>
              <span class="kpi-value">{{ report.kpis.costPerAppointment != null ? money(report.kpis.costPerAppointment) : '—' }}</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-label">Costo por ganado</span>
              <span class="kpi-value">{{ report.kpis.costPerWon != null ? money(report.kpis.costPerWon) : '—' }}</span>
            </div>
            <template v-if="report.kpis.metaImpressions != null">
              <div class="kpi-tile kpi-meta">
                <span class="kpi-label">Impresiones (Ads)</span>
                <span class="kpi-value">{{ num(report.kpis.metaImpressions) }}</span>
                <span class="kpi-sub" v-if="report.kpis.metaReach">Alcance {{ num(report.kpis.metaReach) }}</span>
              </div>
              <div class="kpi-tile kpi-meta">
                <span class="kpi-label">Clics totales</span>
                <span class="kpi-value">{{ num(report.kpis.metaClicks) }}</span>
                <span class="kpi-sub" v-if="report.kpis.metaCtr != null">CTR {{ report.kpis.metaCtr }}%</span>
              </div>
              <div class="kpi-tile kpi-meta">
                <span class="kpi-label">Clics en el enlace</span>
                <span class="kpi-value">{{ num(report.kpis.metaLinkClicks) }}</span>
                <span class="kpi-sub" v-if="report.kpis.metaLinkCtr != null">CTR enlace {{ report.kpis.metaLinkCtr }}%</span>
              </div>
              <div class="kpi-tile kpi-meta" v-if="report.kpis.metaLandingPageViews">
                <span class="kpi-label">Visitas a la página</span>
                <span class="kpi-value">{{ num(report.kpis.metaLandingPageViews) }}</span>
              </div>
              <div class="kpi-tile kpi-meta">
                <span class="kpi-label">Conversaciones (Ads)</span>
                <span class="kpi-value">{{ num(report.kpis.metaMessagingStarted) }}</span>
              </div>
            </template>
          </section>
        </transition>
      </div>

      <!-- Campañas -->
      <section class="campaigns-table-section">
        <p v-if="!report.campaigns.length" class="state-banner">
          Aún no has creado ninguna campaña. Usa <strong>＋ Nueva campaña</strong> o clasifica un anuncio detectado abajo.
        </p>

        <template v-else>
          <div class="table-toolbar">
            <div class="search-box">
              <span class="search-icon" aria-hidden="true">🔍</span>
              <input v-model="searchQuery" type="text" class="search-input" placeholder="Buscar campaña por nombre..." />
              <button v-if="searchQuery" type="button" class="search-clear" title="Limpiar búsqueda" @click="searchQuery = ''">✕</button>
            </div>
            <select v-model="platformFilter" class="filter-select">
              <option v-for="opt in PLATFORM_FILTERS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <select v-model="statusFilter" class="filter-select">
              <option v-for="opt in STATUS_FILTERS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <span class="table-total">Total {{ filteredCampaigns.length }} {{ filteredCampaigns.length === 1 ? 'campaña' : 'campañas' }}</span>
          </div>

          <div v-if="filteredCampaigns.length" class="data-table-wrapper">
            <table class="data-table campaigns-table">
              <thead>
                <tr>
                  <th class="col-campaign">Campaña</th>
                  <th>Estado</th>
                  <th>Fechas</th>
                  <th>Inversión</th>
                  <th>Conversaciones</th>
                  <th>Citas</th>
                  <th>Ganados</th>
                  <th>Costo / cita</th>
                  <th class="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="campaign in pagedCampaigns" :key="campaign.id">
                  <tr class="campaign-row" @click="toggleExpand(campaign.id)">
                    <td class="col-campaign">
                      <div class="campaign-identity">
                        <img
                          v-if="campaignImageUrls[campaign.id]"
                          :src="campaignImageUrls[campaign.id]"
                          alt=""
                          class="campaign-thumb"
                        />
                        <span v-else class="campaign-thumb campaign-thumb-fallback">
                          <BrandIcon :name="brandIconName(campaign.platform)" :size="20" />
                        </span>
                        <div class="campaign-identity-text">
                          <strong class="campaign-name">
                            {{ campaign.name }}
                            <span v-if="campaign.source === 'meta'" class="meta-badge">Meta Ads</span>
                            <span v-else-if="campaign.source === 'tiktok'" class="tiktok-badge">TikTok Ads</span>
                          </strong>
                          <span class="campaign-objective">{{ campaign.objective || 'Sin objetivo registrado' }}</span>
                        </div>
                      </div>
                    </td>
                    <td><span class="pill" :class="statusPillClass(campaign.status)">{{ statusLabel(campaign.status) }}</span></td>
                    <td class="data-mono">{{ dateRangeLabel(campaign) }}</td>
                    <td class="data-mono">{{ money(campaign.metrics.spend) }}</td>
                    <td class="data-mono">{{ num(campaign.metrics.conversations) }}</td>
                    <td class="data-mono">{{ num(campaign.metrics.appointments) }}</td>
                    <td class="data-mono">{{ num(campaign.metrics.won) }}</td>
                    <td class="data-mono">{{ campaign.metrics.costPerAppointment != null ? money(campaign.metrics.costPerAppointment) : '—' }}</td>
                    <td class="col-actions" @click.stop>
                      <button type="button" class="icon-btn" title="Editar campaña" @click="openEditModal(campaign)">✏️</button>
                      <button
                        type="button"
                        class="icon-btn"
                        :class="{ 'is-muted': !campaign.sampleContacts.length }"
                        :title="campaign.sampleContacts.length
                          ? `Trazabilidad de ${campaign.sampleContacts.length} lead(s) de esta campaña`
                          : 'Sin leads atribuidos a esta campaña en el rango'"
                        @click="openTrace(campaign)"
                      >🧭</button>
                      <button
                        v-if="campaign.source !== 'meta' && campaign.source !== 'tiktok'"
                        type="button"
                        class="icon-btn"
                        title="Eliminar campaña"
                        @click="removeCampaign(campaign)"
                      >🗑️</button>
                      <button
                        type="button"
                        class="icon-btn expand-btn"
                        :class="{ 'is-open': expandedId === campaign.id }"
                        :title="expandedId === campaign.id ? 'Ocultar detalle' : 'Ver detalle'"
                        @click="toggleExpand(campaign.id)"
                      >▾</button>
                    </td>
                  </tr>

                  <tr v-if="expandedId === campaign.id" class="campaign-detail-row">
                    <td colspan="9">
                      <div class="campaign-detail">
                        <!-- Barra superior de detalle con sub-pestañas para evitar sobrecarga visual -->
                        <div class="detail-top-bar">
                          <div class="detail-nav-tabs" role="tablist" aria-label="Secciones del detalle de la campaña">
                            <button
                              type="button"
                              class="detail-nav-tab"
                              :class="{ 'is-active': detailTab === 'crm' }"
                              @click="detailTab = 'crm'"
                            >
                              🎯 Embudo &amp; CRM
                            </button>
                            <button
                              v-if="campaign.metaAdsets && campaign.metaAdsets.length"
                              type="button"
                              class="detail-nav-tab"
                              :class="{ 'is-active': detailTab === 'adsets' }"
                              @click="detailTab = 'adsets'"
                            >
                              🗂️ {{ campaign.source === 'tiktok' ? 'Grupos' : 'Conjuntos' }}
                              <span class="detail-tab-count">{{ campaign.metaAdsets.length }}</span>
                            </button>
                            <button
                              v-if="campaign.metaAds && campaign.metaAds.length"
                              type="button"
                              class="detail-nav-tab"
                              :class="{ 'is-active': detailTab === 'ads' }"
                              @click="detailTab = 'ads'"
                            >
                              🧾 Anuncios
                              <span class="detail-tab-count">{{ campaign.metaAds.length }}</span>
                            </button>
                            <button
                              v-if="campaign.metrics.impressions != null"
                              type="button"
                              class="detail-nav-tab"
                              :class="{ 'is-active': detailTab === 'platform' }"
                              @click="detailTab = 'platform'"
                            >
                              📊 {{ campaign.source === 'tiktok' ? 'TikTok Ads' : 'Meta Ads' }}
                            </button>
                            <button
                              type="button"
                              class="detail-nav-tab"
                              :class="{ 'is-active': detailTab === 'all' }"
                              @click="detailTab = 'all'"
                            >
                              📋 Ver todo
                            </button>
                          </div>

                          <span class="campaign-meta">
                            <template v-if="campaign.lastSyncedAt">Sincronizado: {{ formatDateTime(campaign.lastSyncedAt) }}</template>
                            <template v-else>Campaña manual</template>
                          </span>
                        </div>

                        <!-- SECCIÓN 1: Embudo real + Métricas CRM lado a lado -->
                        <div v-if="detailTab === 'crm' || detailTab === 'all'" class="crm-overview-split">
                          <div class="crm-funnel-card">
                            <div class="metrics-block-head">
                              <h4 class="metrics-block-title">🔻 Embudo de Conversión Real</h4>
                              <span class="metrics-block-note">Recorrido de los contactos atribuidos</span>
                            </div>
                            <div class="funnel">
                              <div v-for="(stage, i) in campaign.funnel" :key="stage.key" class="funnel-row">
                                <span class="funnel-label">{{ stage.label }}</span>
                                <div class="funnel-bar-track">
                                  <div
                                    class="funnel-bar-fill"
                                    :style="{ width: funnelBarWidth(campaign.funnel, stage) }"
                                    :title="`${stage.label}: ${num(stage.count)}`"
                                  ></div>
                                  <span class="funnel-bar-value">{{ num(stage.count) }}</span>
                                </div>
                                <span v-if="i > 0" class="funnel-dropoff">{{ dropoffLabel(campaign.funnel[i - 1], stage) }}</span>
                                <span v-else class="funnel-dropoff funnel-dropoff-spacer"></span>
                              </div>
                            </div>
                          </div>

                          <div class="crm-metrics-card">
                            <div class="metrics-block-head">
                              <h4 class="metrics-block-title">🎯 Indicadores Comerciales (CRM)</h4>
                              <span class="metrics-block-note">Tasas de avance, tiempos de respuesta y retorno</span>
                            </div>
                            <div class="metric-grid">
                              <div class="metric"><span class="metric-label">Tasa de calificación</span><span class="metric-value">{{ campaign.metrics.qualificationRate }}%</span></div>
                              <div class="metric"><span class="metric-label">Conversación → cita</span><span class="metric-value">{{ campaign.metrics.conversationToAppointmentRate }}%</span></div>
                              <div class="metric"><span class="metric-label">Asistencia a citas</span><span class="metric-value">{{ campaign.metrics.attendanceRate }}%</span></div>
                              <div class="metric"><span class="metric-label">Cita asistida → ganado</span><span class="metric-value">{{ campaign.metrics.attendedToWonRate }}%</span></div>
                              <div class="metric"><span class="metric-label">Viabilidad prom.</span><span class="metric-value">{{ campaign.metrics.avgViability != null ? campaign.metrics.avgViability + '%' : '—' }}</span></div>
                              <div class="metric"><span class="metric-label">1ª respuesta (mediana)</span><span class="metric-value">{{ responseLabel(campaign.metrics.medianFirstResponseMin) }}</span></div>
                              <div class="metric"><span class="metric-label">1ª respuesta (P90)</span><span class="metric-value">{{ responseLabel(campaign.metrics.p90FirstResponseMin) }}</span></div>
                              <div class="metric"><span class="metric-label">Sin respuesta</span><span class="metric-value">{{ num(campaign.metrics.noFirstResponse) }}</span></div>
                              <div class="metric"><span class="metric-label">Costo / conversación</span><span class="metric-value">{{ campaign.metrics.costPerConversation != null ? money(campaign.metrics.costPerConversation) : '—' }}</span></div>
                              <div class="metric"><span class="metric-label">Costo / cita asistida</span><span class="metric-value">{{ campaign.metrics.costPerAttended != null ? money(campaign.metrics.costPerAttended) : '—' }}</span></div>
                              <div class="metric"><span class="metric-label">Costo / ganado</span><span class="metric-value">{{ campaign.metrics.costPerWon != null ? money(campaign.metrics.costPerWon) : '—' }}</span></div>
                              <div class="metric"><span class="metric-label">Valor cotizado (pipeline)</span><span class="metric-value">{{ money(campaign.metrics.quotedValue) }}</span></div>
                              <div class="metric"><span class="metric-label">Cobrado y verificado</span><span class="metric-value">{{ money(campaign.metrics.collectedRevenue) }}</span></div>
                              <div class="metric"><span class="metric-label">Cuota pactada sin cerrar</span><span class="metric-value">{{ money(campaign.metrics.pactedRevenue) }}</span></div>
                              <div class="metric"><span class="metric-label">ROAS (sobre cobrado)</span><span class="metric-value">{{ campaign.metrics.roas != null ? campaign.metrics.roas + '×' : '—' }}</span></div>
                            </div>
                          </div>
                        </div>

                        <!-- SECCIÓN 2: Métricas del Administrador de anuncios -->
                        <div v-if="(detailTab === 'platform' || detailTab === 'all') && campaign.metrics.impressions != null" class="metrics-block">
                          <div class="metrics-block-head">
                            <h4 class="metrics-block-title">📊 {{ campaign.source === 'tiktok' ? 'TikTok Ads' : 'Meta Ads' }}</h4>
                            <span class="metrics-block-note">
                              Informe {{ reportWindowLabel(campaign.metrics) }}
                              <template v-if="campaign.metrics.attributionSetting">
                                · Configuración de atribución: {{ campaign.metrics.attributionSetting }}
                              </template>
                            </span>
                          </div>
                          <div class="metric-grid">
                            <div class="metric metric-meta">
                              <span class="metric-label">Resultados</span>
                              <span class="metric-value">{{ campaign.metrics.metaResults != null ? num(campaign.metrics.metaResults) : '—' }}</span>
                              <span v-if="campaign.metrics.metaResultIndicator" class="metric-sub">{{ campaign.metrics.metaResultIndicator }}</span>
                            </div>
                            <div class="metric metric-meta"><span class="metric-label">Coste por resultado</span><span class="metric-value">{{ campaign.metrics.metaCostPerResult != null ? money(campaign.metrics.metaCostPerResult) : '—' }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Importe gastado</span><span class="metric-value">{{ money(campaign.metrics.metaSpend ?? campaign.metrics.spend) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Alcance</span><span class="metric-value">{{ num(campaign.metrics.reach) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Frecuencia</span><span class="metric-value">{{ campaign.metrics.frequency != null ? campaign.metrics.frequency : '—' }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Impresiones</span><span class="metric-value">{{ num(campaign.metrics.impressions) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">CPM</span><span class="metric-value">{{ campaign.metrics.cpm != null ? money(campaign.metrics.cpm) : '—' }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Clics en el enlace</span><span class="metric-value">{{ num(campaign.metrics.linkClicks) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">CTR del enlace</span><span class="metric-value">{{ pct(campaign.metrics.linkCtr) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">CPC del enlace</span><span class="metric-value">{{ campaign.metrics.costPerLinkClick != null ? money(campaign.metrics.costPerLinkClick) : '—' }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Clics (todos)</span><span class="metric-value">{{ num(campaign.metrics.clicks) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">CTR (todos)</span><span class="metric-value">{{ pct(campaign.metrics.ctr) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">CPC (todos)</span><span class="metric-value">{{ campaign.metrics.cpc != null ? money(campaign.metrics.cpc) : '—' }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Visitas a la página de destino</span><span class="metric-value">{{ num(campaign.metrics.landingPageViews) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Coste por visita a la página</span><span class="metric-value">{{ campaign.metrics.costPerLandingPageView != null ? money(campaign.metrics.costPerLandingPageView) : '—' }}</span></div>
                            <div v-if="campaign.metrics.shopClicks" class="metric metric-meta"><span class="metric-label">Clics en la tienda</span><span class="metric-value">{{ num(campaign.metrics.shopClicks) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Conversaciones ({{ adsSourceLabel(campaign) }})</span><span class="metric-value">{{ num(campaign.metrics.metaMessagingStarted) }}</span></div>
                            <div class="metric metric-meta"><span class="metric-label">Costo/conv. ({{ adsSourceLabel(campaign) }})</span><span class="metric-value">{{ campaign.metrics.costPerLeadMeta != null ? money(campaign.metrics.costPerLeadMeta) : '—' }}</span></div>
                          </div>
                        </div>

                        <!-- SECCIÓN 3: Desglose por conjunto de anuncios -->
                        <div v-if="(detailTab === 'adsets' || detailTab === 'all') && campaign.metaAdsets && campaign.metaAdsets.length" class="metrics-block">
                          <div class="metrics-block-head">
                            <div>
                              <h4 class="metrics-block-title">🗂️ Rendimiento por {{ groupNoun(campaign).long }}</h4>
                              <span class="metrics-block-note">
                                Informe {{ reportWindowLabel(campaign.metrics) }} ·
                                {{ campaign.metaAdsets.length }}
                                {{ campaign.metaAdsets.length === 1 ? groupNoun(campaign).one : groupNoun(campaign).many }}
                                <template v-if="campaign.budgetType">
                                  · Presupuesto de la campaña: {{ campaign.budgetType === 'diario' ? 'diario' : 'total' }}
                                </template>
                                <template v-else>· El presupuesto lo lleva cada {{ groupNoun(campaign).one }}</template>
                              </span>
                            </div>
                            <button
                              type="button"
                              class="col-density-btn"
                              @click="showAllAdColumns = !showAllAdColumns"
                            >
                              {{ showAllAdColumns ? '👁️ Vista esencial (8 cols)' : '📐 Ver las 21 columnas' }}
                            </button>
                          </div>
                          <div class="ads-insights-wrapper">
                            <table class="data-table ads-insights-table">
                              <thead>
                                <tr>
                                  <th class="col-ad-name">Nombre del {{ groupNoun(campaign).one }}</th>
                                  <th>Entrega</th>
                                  <th>Anuncios</th>
                                  <th>Presupuesto</th>
                                  <th>Importe gastado</th>
                                  <th>Resultados</th>
                                  <th>Coste / res.</th>
                                  <th>Alcance</th>
                                  <th>Clics enlace</th>
                                  <th>CTR enlace</th>
                                  <template v-if="showAllAdColumns">
                                    <th>Frecuencia</th>
                                    <th>Optimización</th>
                                    <th>Fin</th>
                                    <th>Impresiones</th>
                                    <th>CPM</th>
                                    <th>CPC del enlace</th>
                                    <th>Clics (todos)</th>
                                    <th>CTR (todos)</th>
                                    <th>CPC (todos)</th>
                                    <th>Visitas a la página</th>
                                    <th>Coste por visita</th>
                                  </template>
                                </tr>
                              </thead>
                              <tbody>
                                <tr v-for="set in campaign.metaAdsets" :key="set.adsetId">
                                  <td class="col-ad-name">
                                    <strong class="ad-row-name" :title="set.adsetName">{{ set.adsetName }}</strong>
                                    <span v-if="!set.hasInsights" class="ad-row-sub">Sin entrega en este periodo</span>
                                  </td>
                                  <td><span class="pill pill-xs" :class="deliveryPillClass(set.delivery)">{{ deliveryLabel(set.delivery) }}</span></td>
                                  <td class="data-mono">{{ num(adCountForAdset(campaign, set.adsetId)) }}</td>
                                  <td class="data-mono">
                                    {{ set.budget != null ? money(set.budget) : '—' }}
                                    <span v-if="set.budgetType" class="ad-row-sub">{{ set.budgetType === 'diario' ? 'Diario' : 'Total' }}</span>
                                  </td>
                                  <td class="data-mono"><strong>{{ money(set.spend) }}</strong></td>
                                  <td class="data-mono">
                                    {{ numOrDash(set.results) }}
                                    <span v-if="set.resultIndicator" class="ad-row-sub">{{ set.resultIndicator }}</span>
                                  </td>
                                  <td class="data-mono">{{ set.costPerResult != null ? money(set.costPerResult) : '—' }}</td>
                                  <td class="data-mono">{{ numOrDash(set.reach) }}</td>
                                  <td class="data-mono">{{ numOrDash(set.linkClicks) }}</td>
                                  <td class="data-mono">{{ pct(set.linkCtr) }}</td>
                                  <template v-if="showAllAdColumns">
                                    <td class="data-mono">{{ set.frequency != null ? set.frequency : '—' }}</td>
                                    <td class="data-mono">{{ optimizationGoalLabel(set.optimizationGoal) }}</td>
                                    <td class="data-mono">{{ set.endTime ? formatDate(set.endTime) : 'Sin fecha' }}</td>
                                    <td class="data-mono">{{ numOrDash(set.impressions) }}</td>
                                    <td class="data-mono">{{ set.cpm != null ? money(set.cpm) : '—' }}</td>
                                    <td class="data-mono">{{ set.costPerLinkClick != null ? money(set.costPerLinkClick) : '—' }}</td>
                                    <td class="data-mono">{{ numOrDash(set.clicks) }}</td>
                                    <td class="data-mono">{{ pct(set.ctr) }}</td>
                                    <td class="data-mono">{{ set.cpc != null ? money(set.cpc) : '—' }}</td>
                                    <td class="data-mono">{{ numOrDash(set.landingPageViews) }}</td>
                                    <td class="data-mono">{{ set.costPerLandingPageView != null ? money(set.costPerLandingPageView) : '—' }}</td>
                                  </template>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <!-- SECCIÓN 4: Desglose por anuncio -->
                        <div v-if="(detailTab === 'ads' || detailTab === 'all') && campaign.metaAds && campaign.metaAds.length" class="metrics-block">
                          <div class="metrics-block-head">
                            <div>
                              <h4 class="metrics-block-title">🧾 Rendimiento por anuncio</h4>
                              <span class="metrics-block-note">
                                Informe {{ reportWindowLabel(campaign.metrics) }} ·
                                {{ campaign.metaAds.length }} {{ campaign.metaAds.length === 1 ? 'anuncio' : 'anuncios' }}
                              </span>
                            </div>
                            <button
                              type="button"
                              class="col-density-btn"
                              @click="showAllAdColumns = !showAllAdColumns"
                            >
                              {{ showAllAdColumns ? '👁️ Vista esencial (9 cols)' : '📐 Ver las 23 columnas' }}
                            </button>
                          </div>
                          <div class="ads-insights-wrapper">
                            <table class="data-table ads-insights-table">
                              <thead>
                                <tr>
                                  <th class="col-ad-name">Nombre del anuncio</th>
                                  <th>Entrega</th>
                                  <th>Importe gastado</th>
                                  <th>Resultados</th>
                                  <th>Coste / res.</th>
                                  <th>Alcance</th>
                                  <th>Clics enlace</th>
                                  <th>CTR enlace</th>
                                  <th>Calidad</th>
                                  <template v-if="showAllAdColumns">
                                    <th>Frecuencia</th>
                                    <th>Presupuesto del conjunto</th>
                                    <th>Fin</th>
                                    <th>Interacción</th>
                                    <th>Conversión</th>
                                    <th>Impresiones</th>
                                    <th>CPM</th>
                                    <th>Clics en la tienda</th>
                                    <th>CPC del enlace</th>
                                    <th>Clics (todos)</th>
                                    <th>CTR (todos)</th>
                                    <th>CPC (todos)</th>
                                    <th>Visitas a la página</th>
                                    <th>Coste por visita</th>
                                  </template>
                                </tr>
                              </thead>
                              <tbody>
                                <tr v-for="ad in campaign.metaAds" :key="ad.adId">
                                  <td class="col-ad-name">
                                    <div class="ad-row-identity">
                                      <img
                                        v-if="adImageUrls[ad.adId]"
                                        :src="adImageUrls[ad.adId]"
                                        alt=""
                                        class="ad-row-thumb"
                                      />
                                      <span v-else class="ad-row-thumb ad-row-thumb-fallback" aria-hidden="true">🖼️</span>
                                      <span class="ad-row-identity-text">
                                        <strong class="ad-row-name" :title="ad.adName">{{ ad.adName }}</strong>
                                        <span v-if="ad.adsetName" class="ad-row-sub">{{ ad.adsetName }}</span>
                                        <span v-if="!ad.hasInsights" class="ad-row-sub">Sin entrega en este periodo</span>
                                      </span>
                                    </div>
                                  </td>
                                  <td><span class="pill pill-xs" :class="deliveryPillClass(ad.delivery)">{{ deliveryLabel(ad.delivery) }}</span></td>
                                  <td class="data-mono"><strong>{{ money(ad.spend) }}</strong></td>
                                  <td class="data-mono">
                                    {{ numOrDash(ad.results) }}
                                    <span v-if="ad.resultIndicator" class="ad-row-sub">{{ ad.resultIndicator }}</span>
                                  </td>
                                  <td class="data-mono">{{ ad.costPerResult != null ? money(ad.costPerResult) : '—' }}</td>
                                  <td class="data-mono">{{ numOrDash(ad.reach) }}</td>
                                  <td class="data-mono">{{ numOrDash(ad.linkClicks) }}</td>
                                  <td class="data-mono">{{ pct(ad.linkCtr) }}</td>
                                  <td><span class="pill pill-xs" :class="rankPillClass(ad.qualityRanking)" :title="rankTitle(ad.qualityRanking)">{{ rankLabel(ad.qualityRanking) }}</span></td>
                                  <template v-if="showAllAdColumns">
                                    <td class="data-mono">{{ ad.frequency != null ? ad.frequency : '—' }}</td>
                                    <td class="data-mono">
                                      {{ ad.adsetBudget != null ? money(ad.adsetBudget) : '—' }}
                                      <span v-if="ad.adsetBudgetType" class="ad-row-sub">{{ ad.adsetBudgetType === 'diario' ? 'Diario' : 'Total' }}</span>
                                    </td>
                                    <td class="data-mono">{{ ad.endTime ? formatDate(ad.endTime) : 'Sin fecha' }}</td>
                                    <td><span class="pill pill-xs" :class="rankPillClass(ad.engagementRanking)" :title="rankTitle(ad.engagementRanking)">{{ rankLabel(ad.engagementRanking) }}</span></td>
                                    <td><span class="pill pill-xs" :class="rankPillClass(ad.conversionRanking)" :title="rankTitle(ad.conversionRanking)">{{ rankLabel(ad.conversionRanking) }}</span></td>
                                    <td class="data-mono">{{ numOrDash(ad.impressions) }}</td>
                                    <td class="data-mono">{{ ad.cpm != null ? money(ad.cpm) : '—' }}</td>
                                    <td class="data-mono">{{ numOrDash(ad.shopClicks) }}</td>
                                    <td class="data-mono">{{ ad.costPerLinkClick != null ? money(ad.costPerLinkClick) : '—' }}</td>
                                    <td class="data-mono">{{ numOrDash(ad.clicks) }}</td>
                                    <td class="data-mono">{{ pct(ad.ctr) }}</td>
                                    <td class="data-mono">{{ ad.cpc != null ? money(ad.cpc) : '—' }}</td>
                                    <td class="data-mono">{{ numOrDash(ad.landingPageViews) }}</td>
                                    <td class="data-mono">{{ ad.costPerLandingPageView != null ? money(ad.costPerLandingPageView) : '—' }}</td>
                                  </template>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <!-- Anuncios mapeados -->
                        <div class="ad-chips">
                          <span class="ad-chips-label">Anuncios asociados ({{ campaign.ads.length }}):</span>
                          <span v-for="ad in campaign.ads.slice(0, 12)" :key="ad.id" class="ad-chip">
                            {{ ad.label || ad.sourceId }}
                            <button type="button" class="ad-chip-x" title="Quitar anuncio" @click="detachAd(ad.id)">✕</button>
                          </span>
                          <span v-if="campaign.ads.length > 12" class="ad-chips-empty">+{{ campaign.ads.length - 12 }} más</span>
                          <span v-if="!campaign.ads.length" class="ad-chips-empty">sin anuncios asociados</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div v-else class="empty-state">
            <span class="empty-state-icon" aria-hidden="true">🔍</span>
            <p class="empty-state-title">Sin resultados</p>
            <p class="empty-state-text">Ninguna campaña coincide con los filtros aplicados.</p>
          </div>

          <div v-if="filteredCampaigns.length" class="table-pagination">
            <button type="button" class="page-btn" :disabled="currentPage === 1" @click="currentPage--">‹</button>
            <span class="page-indicator">Página {{ currentPage }} de {{ totalPages }}</span>
            <button type="button" class="page-btn" :disabled="currentPage === totalPages" @click="currentPage++">›</button>
            <select v-model.number="pageSize" class="page-size-select">
              <option :value="10">10 / pág.</option>
              <option :value="25">25 / pág.</option>
              <option :value="50">50 / pág.</option>
            </select>
          </div>
        </template>
      </section>

      <!-- Anuncios sin clasificar -->
      <section v-if="report.unclassifiedAds.length" class="unclassified-section">
        <h3 class="unclassified-heading">🧩 Anuncios detectados sin clasificar</h3>
        <p class="unclassified-hint">
          Meta reportó tráfico de estos anuncios pero aún no los has asociado a ninguna campaña. Sus leads no cuentan
          para el costo de ninguna campaña hasta que los asignes.
        </p>
        <div class="unclassified-list">
          <div v-for="ad in report.unclassifiedAds" :key="ad.sourceId" class="unclassified-card">
            <div class="unclassified-main">
              <BrandIcon :name="brandIconName(ad.platform)" :size="20" />
              <div>
                <strong class="unclassified-title">{{ ad.headline || 'Anuncio ' + ad.sourceId }}</strong>
                <span class="unclassified-id data-mono">ID {{ ad.sourceId }}</span>
              </div>
            </div>
            <div class="unclassified-stats">
              <span>{{ num(ad.conversations) }} conv.</span>
              <span>{{ num(ad.qualified) }} calif.</span>
              <span>{{ num(ad.appointments) }} citas</span>
              <span>{{ num(ad.won) }} ganados</span>
            </div>
            <div class="unclassified-actions">
              <select v-model="assignSelection[ad.sourceId]" class="assign-select">
                <option value="">Asignar a campaña…</option>
                <option v-for="c in report.campaigns" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <button
                type="button"
                class="btn-secondary btn-mini"
                :disabled="!assignSelection[ad.sourceId]"
                @click="assignAd(ad)"
              >Asignar</button>
              <button type="button" class="btn-secondary btn-mini" @click="openCreateModal(ad)">Crear campaña</button>
            </div>
          </div>
        </div>
      </section>

      <p class="generated-note">
        Actualizado {{ formatDateTime(report.generatedAt) }} · rango:
        {{ report.range.from ? 'desde ' + formatDate(report.range.from) : 'todo el histórico' }}
      </p>
    </template>

    <!-- Modal de campaña -->
    <!-- Trazabilidad de leads: el recorrido real de cada contacto, agrupado
         por el anuncio del que llegó. -->
    <div v-if="traceCampaign" class="cmp-modal-overlay" @click.self="closeTrace">
      <div class="cmp-modal cmp-modal-wide">
        <div class="cmp-modal-head">
          <div class="trace-head-text">
            <h3>🧭 Trazabilidad de leads</h3>
            <span class="trace-head-sub">{{ traceCampaign.name }} · {{ rangeLabel }}</span>
          </div>
          <button type="button" class="icon-btn" @click="closeTrace">✕</button>
        </div>

        <div class="cmp-modal-body trace-modal-body">
          <p v-if="!traceCampaign.sampleContacts.length" class="trace-hint">
            Todavía no hay contactos atribuidos a esta campaña en el rango seleccionado.
          </p>

          <template v-else>
            <!-- Resumen del embudo, para leer el detalle en contexto -->
            <div class="trace-summary">
              <div v-for="stage in traceSummary" :key="stage.key" class="trace-summary-item">
                <span class="trace-summary-value">{{ num(stage.count) }}</span>
                <span class="trace-summary-label">{{ stage.label }}</span>
              </div>
            </div>

            <div v-for="group in traceGroups" :key="group.key" class="trace-ad-group">
              <!-- De qué anuncio llegaron estos leads -->
              <div class="trace-ad-head">
                <img
                  v-if="group.adId && adImageUrls[group.adId]"
                  :src="adImageUrls[group.adId]"
                  alt=""
                  class="trace-ad-thumb"
                />
                <span v-else class="trace-ad-thumb trace-ad-thumb-fallback" aria-hidden="true">🖼️</span>
                <div class="trace-ad-text">
                  <strong class="trace-ad-name">{{ group.adName }}</strong>
                  <span class="trace-ad-sub">
                    <template v-if="group.adsetName">{{ group.adsetName }} · </template>
                    <template v-if="group.adHeadline">“{{ group.adHeadline }}” · </template>
                    ID {{ group.adSourceId || '—' }}
                  </span>
                </div>
                <span class="trace-ad-count">
                  {{ group.leads.length }} {{ group.leads.length === 1 ? 'lead' : 'leads' }}
                  <template v-if="group.won"> · {{ group.won }} ganado(s)</template>
                </span>
              </div>

              <div class="trace-leads">
                <div v-for="(lead, li) in group.leads" :key="li" class="trace-lead">
                  <div class="trace-lead-header">
                    <strong class="trace-lead-name">{{ lead.name }}</strong>
                    <span v-if="lead.topic" class="trace-lead-topic">{{ lead.topic }}</span>
                    <span class="pill" :class="stagePillClass(lead.currentStage)">{{ stageLabel(lead.currentStage) }}</span>
                    <span v-if="lead.viability != null" class="pill pill-neutral">Viab. {{ lead.viability }}%</span>
                    <span v-if="lead.quotedValue" class="pill pill-neutral">{{ money(lead.quotedValue) }}</span>
                  </div>
                  <ol class="trace-timeline">
                    <li
                      v-for="(step, idx) in lead.timeline"
                      :key="idx"
                      class="trace-step"
                      :class="{ 'is-last': idx === lead.timeline.length - 1 }"
                    >
                      <span class="trace-step-dot" :class="stepDotClass(lead, step, idx)"></span>
                      <span class="trace-step-body">
                        <span class="trace-step-label">{{ step.stage }}</span>
                        <span class="trace-step-time data-mono">
                          <template v-if="step.at">{{ formatDateTime(step.at) }}</template>
                          <template v-else-if="step.note">{{ step.note }}</template>
                        </span>
                      </span>
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!--
      Leads de formulario instantáneo de TikTok.

      Dos pasos a propósito, igual que la conciliación de Meta: al abrir solo
      se COMPARA (el GET no escribe nada) y recién el botón de adentro importa.
      Traer leads agrega gente al funnel que el equipo va a trabajar y a
      repartir, así que no puede ser el efecto de abrir una pantalla.
    -->
    <div v-if="showTikTokLeads" class="cmp-modal-overlay" @click.self="closeTikTokLeads">
      <div class="cmp-modal cmp-modal-wide">
        <div class="cmp-modal-head">
          <div class="trace-head-text">
            <h3>📥 Leads de formulario de TikTok</h3>
            <span class="trace-head-sub">Compara lo que TikTok tiene contra lo que llegó al CRM</span>
          </div>
          <button type="button" class="icon-btn" @click="closeTikTokLeads">✕</button>
        </div>

        <div class="cmp-modal-body trace-modal-body">
          <p v-if="ttLeadsLoading" class="trace-hint">⏳ Preguntándole a TikTok… puede tardar unos segundos: hay que pedirle una descarga por formulario y esperar a que la prepare.</p>

          <p v-else-if="ttLeadsError" class="state-banner state-hint">
            ⚠️ {{ ttLeadsError }}
          </p>

          <template v-else-if="ttLeadsReport">
            <p v-if="ttLeadsReport.aviso" class="state-banner state-hint">⚠️ {{ ttLeadsReport.aviso }}</p>

            <div class="trace-summary">
              <div class="trace-summary-item">
                <span class="trace-summary-value">{{ num(ttLeadsReport.totals.en_tiktok) }}</span>
                <span class="trace-summary-label">En TikTok</span>
              </div>
              <div class="trace-summary-item">
                <span class="trace-summary-value">{{ num(ttLeadsReport.totals.en_crm) }}</span>
                <span class="trace-summary-label">Ya en el CRM</span>
              </div>
              <div class="trace-summary-item">
                <span class="trace-summary-value">{{ num(ttLeadsReport.totals.faltantes) }}</span>
                <span class="trace-summary-label">Faltan</span>
              </div>
              <div v-if="ttLeadsReport.aplicado" class="trace-summary-item">
                <span class="trace-summary-value">{{ num(ttLeadsReport.totals.importados) }}</span>
                <span class="trace-summary-label">Importados</span>
              </div>
              <div v-if="ttLeadsReport.aplicado" class="trace-summary-item">
                <span class="trace-summary-value">{{ num(ttLeadsReport.totals.adjuntados) }}</span>
                <span class="trace-summary-label">Adjuntados</span>
              </div>
            </div>

            <!--
              "Adjuntado" se dice aparte de "importado" porque no es lo mismo
              para quien lee esto: un importado es una persona más para
              trabajar, y un adjuntado es un formulario que se sumó a una ficha
              que el equipo ya tenía (mismo teléfono).
            -->
            <p v-if="ttLeadsReport.aplicado" class="trace-hint">
              Los <strong>adjuntados</strong> no son gente nueva: esa persona ya era un lead y el
              formulario se sumó a su ficha en vez de abrirle una segunda.
            </p>

            <p v-if="!ttLeadsReport.aplicado && ttLeadsReport.totals.faltantes === 0" class="trace-hint">
              ✅ No falta ninguno: todos los leads de los formularios de TikTok ya están en el CRM.
            </p>

            <table v-if="ttLeadsReport.forms.length" class="data-table tt-forms-table">
              <thead>
                <tr>
                  <th>Formulario</th>
                  <th>En TikTok</th>
                  <th>En el CRM</th>
                  <th>Faltan</th>
                  <th v-if="ttLeadsReport.aplicado">Importados</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in ttLeadsReport.forms" :key="f.page_id">
                  <td>
                    {{ f.nombre || 'Formulario sin nombre' }}
                    <span class="data-mono tt-form-id">{{ f.page_id }}</span>
                  </td>
                  <td>{{ num(f.en_tiktok) }}</td>
                  <td>{{ num(f.en_crm) }}</td>
                  <td>{{ num(f.faltantes) }}</td>
                  <td v-if="ttLeadsReport.aplicado">{{ num(f.importados + f.adjuntados) }}</td>
                </tr>
              </tbody>
            </table>

            <p v-if="ttLeadsReport.errores.length" class="state-banner state-hint">
              ⚠️ {{ ttLeadsReport.errores.length }} formulario(s) no se pudieron leer:
              {{ ttLeadsReport.errores.map(e => e.error).join(' · ') }}
            </p>
          </template>
        </div>

        <div class="cmp-modal-actions tt-leads-actions">
          <button type="button" class="btn-secondary" @click="closeTikTokLeads">Cerrar</button>
          <button
            type="button"
            class="btn-primary"
            :disabled="ttLeadsLoading || ttLeadsImporting || !ttLeadsReport || !ttLeadsReport.totals.faltantes"
            @click="importTikTokLeads"
          >{{ ttLeadsImporting ? '⏳ Importando…' : `Importar ${ttLeadsReport ? ttLeadsReport.totals.faltantes : 0} lead(s)` }}</button>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="cmp-modal-overlay" @click.self="closeModal">
      <div class="cmp-modal">
        <div class="cmp-modal-head">
          <h3>{{ editingId ? 'Editar campaña' : 'Nueva campaña' }}</h3>
          <button type="button" class="icon-btn" @click="closeModal">✕</button>
        </div>
        <form class="cmp-modal-body" @submit.prevent="saveCampaign">
          <label class="fld">
            <span>Nombre *</span>
            <input v-model="form.name" type="text" required placeholder="Ej: Ingeniería Civil — Lima Norte" />
          </label>
          <div class="fld-row">
            <label class="fld">
              <span>Plataforma</span>
              <select v-model="form.platform">
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="meta">Meta (ambas)</option>
                <option value="tiktok">TikTok</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="other">Otra</option>
              </select>
            </label>
            <label class="fld">
              <span>Estado</span>
              <select v-model="form.status">
                <option value="activa">Activa</option>
                <option value="pausada">Pausada</option>
                <option value="finalizada">Finalizada</option>
              </select>
            </label>
          </div>
          <label class="fld">
            <span>Objetivo (opcional)</span>
            <input v-model="form.objective" type="text" placeholder="Ej: Mensajes / Conversaciones" />
          </label>
          <div class="fld-row">
            <label class="fld">
              <span>Presupuesto total ({{ form.currency }})</span>
              <input v-model="form.budgetTotal" type="number" min="0" step="0.01" placeholder="850" />
            </label>
            <label class="fld">
              <span>Gasto a la fecha (opcional)</span>
              <input v-model="form.spendToDate" type="number" min="0" step="0.01" placeholder="Se usa para los costos reales" />
            </label>
            <label class="fld fld-narrow">
              <span>Moneda</span>
              <select v-model="form.currency">
                <option value="PEN">S/</option>
                <option value="USD">US$</option>
              </select>
            </label>
          </div>
          <div class="fld-row">
            <label class="fld"><span>Inicio</span><input v-model="form.startDate" type="date" /></label>
            <label class="fld"><span>Fin</span><input v-model="form.endDate" type="date" /></label>
          </div>
          <label class="fld">
            <span>ID(s) de anuncio a asociar (opcional, separados por coma)</span>
            <input v-model="form.adSourceIds" type="text" placeholder="120210000000000001, 120210000000000002" />
            <small class="fld-help">Es el <code>source_id</code> del anuncio. Puedes dejarlo vacío y clasificar los anuncios detectados desde la lista de abajo.</small>
          </label>
          <label class="fld">
            <span>Notas</span>
            <textarea v-model="form.notes" rows="2" placeholder="Segmentación, creatividades, etc."></textarea>
          </label>
          <p v-if="modalError" class="cmp-modal-error">{{ modalError }}</p>
          <div class="cmp-modal-actions">
            <button type="button" class="btn-secondary" @click="closeModal">Cancelar</button>
            <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </form>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { loadApiImage } from '../apiImage.js';
import BrandIcon from '../components/BrandIcon.vue';
import AppLoader from '../components/AppLoader.vue';

/**
 * "Hoy" no son las últimas 24 h: es desde las 00:00 de hoy, que es lo que se
 * compara contra la columna "Hoy" del Administrador de anuncios. Por eso va
 * como valor propio y no como un número de días (ver `rangeFrom`).
 */
const TODAY_RANGE = 'today';

const RANGE_OPTIONS = [
  { value: TODAY_RANGE, label: 'Hoy' },
  { value: 7, label: '7 días' },
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
  { value: 0, label: 'Todo' }
];

const report = ref(null);
const loading = ref(false);
const errorMsg = ref('');
const rangeDays = ref(30);

/** Inicio del rango elegido; `null` cuando es "Todo" (sin filtro de fecha). */
function rangeFrom() {
  if (rangeDays.value === TODAY_RANGE) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }
  return rangeDays.value > 0 ? new Date(Date.now() - rangeDays.value * 86400000) : null;
}
const traceCampaign = ref(null);
const expandedId = ref(null);
const showExtraKpis = ref(false);
const detailTab = ref('crm');
const showAllAdColumns = ref(false);
const assignSelection = reactive({});

// ─────────────────────── Búsqueda, filtros y paginación ───────────────────
const searchQuery = ref('');
const platformFilter = ref('all');
const statusFilter = ref('all');
const currentPage = ref(1);
const pageSize = ref(10);

const PLATFORM_FILTERS = [
  { value: 'all', label: 'Todas las plataformas' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'meta', label: 'Meta (ambas)' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'other', label: 'Otra' }
];

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'activa', label: 'Activa' },
  { value: 'pausada', label: 'Pausada' },
  { value: 'finalizada', label: 'Finalizada' }
];

const filteredCampaigns = computed(() => {
  const list = report.value?.campaigns || [];
  const query = searchQuery.value.trim().toLowerCase();
  return list.filter((c) => {
    if (query && !c.name.toLowerCase().includes(query)) return false;
    if (platformFilter.value !== 'all' && c.platform !== platformFilter.value) return false;
    if (statusFilter.value !== 'all' && c.status !== statusFilter.value) return false;
    return true;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredCampaigns.value.length / pageSize.value)));

const pagedCampaigns = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredCampaigns.value.slice(start, start + pageSize.value);
});

watch([searchQuery, platformFilter, statusFilter, pageSize], () => { currentPage.value = 1; });
watch(totalPages, (max) => { if (currentPage.value > max) currentPage.value = max; });

// ────────────────────── Miniatura del anuncio (Meta) ───────────────────────
// Cada campaña sincronizada con Meta guarda una copia local del thumbnail
// del creativo de su primer anuncio (ver metaAdsService.sync()); se sirve
// por /api/campaigns/:id/image y se pide solo cuando `hasImage` es true.
const campaignImageUrls = reactive({});

function releaseCampaignImages(keepIds) {
  for (const key of Object.keys(campaignImageUrls)) {
    if (keepIds.has(key)) continue;
    URL.revokeObjectURL(campaignImageUrls[key]);
    delete campaignImageUrls[key];
  }
}

async function hydrateCampaignImages(campaigns) {
  const withImage = campaigns.filter((c) => c.hasImage);
  releaseCampaignImages(new Set(withImage.map((c) => String(c.id))));
  for (const c of withImage) {
    const key = String(c.id);
    if (campaignImageUrls[key]) continue;
    const url = await loadApiImage(`/api/campaigns/${c.id}/image`);
    if (url) campaignImageUrls[key] = url;
  }
}

// Miniatura de cada anuncio dentro del detalle. A diferencia de la de la
// campaña, sólo se pide al desplegar la fila: una cuenta con decenas de
// anuncios dispararía una petición por anuncio en cada carga del informe.
const adImageUrls = reactive({});

function releaseAdImages() {
  for (const key of Object.keys(adImageUrls)) {
    URL.revokeObjectURL(adImageUrls[key]);
    delete adImageUrls[key];
  }
}

async function hydrateAdImages(campaign) {
  for (const ad of campaign?.metaAds || []) {
    const key = String(ad.adId);
    if (adImageUrls[key]) continue;
    const url = await loadApiImage(`/api/campaigns/${campaign.id}/ads/${ad.adId}/image`);
    if (url) adImageUrls[key] = url;
  }
}

onBeforeUnmount(() => {
  releaseCampaignImages(new Set());
  releaseAdImages();
});

const exporting = ref(false);
const exportMsg = ref('');

const metaStatus = ref(null);
const tiktokStatus = ref(null);
const syncing = ref(false);
const syncingTikTok = ref(false);

/*
 * Leads de formulario instantáneo de TikTok. El modal se abre comparando (el
 * GET no escribe nada) y el botón de adentro es el que importa: ver la nota
 * del template.
 */
/**
 * De qué Administrador de anuncios salen las métricas de esta campaña.
 *
 * Las dos integraciones escriben en las mismas columnas (`meta_insights`),
 * así que el origen no se deduce del dato: lo dice `campaigns.source`.
 */
function adsSourceLabel(campaign) {
  return campaign?.source === 'tiktok' ? 'TikTok' : 'Meta';
}

const showTikTokLeads = ref(false);
const ttLeadsReport = ref(null);
const ttLeadsLoading = ref(false);
const ttLeadsImporting = ref(false);
const ttLeadsError = ref('');
// El mensaje de resultado es uno solo: las dos sincronizaciones no corren a la
// vez y así el usuario no acumula banners de la plataforma que ya revisó.
const syncMsg = ref('');
const syncError = ref(false);

const showModal = ref(false);
const editingId = ref(null);
const saving = ref(false);
const modalError = ref('');
const form = reactive({
  name: '', platform: 'instagram', status: 'activa', objective: '',
  budgetTotal: '', spendToDate: '', currency: 'PEN',
  startDate: '', endDate: '', adSourceIds: '', notes: ''
});

// ─────────────────────────── Carga de datos ───────────────────────────
async function loadReport() {
  loading.value = true;
  errorMsg.value = '';
  try {
    const params = new URLSearchParams();
    const from = rangeFrom();
    if (from) params.set('from', from.toISOString());
    const res = await apiFetch(`/api/campaigns/performance?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el rendimiento.');
    report.value = data;
    traceCampaign.value = null;
    releaseAdImages();
    await hydrateCampaignImages(data.campaigns || []);
  } catch (err) {
    errorMsg.value = err.message;
  } finally {
    loading.value = false;
  }
}

function setRange(value) {
  rangeDays.value = value;
  loadReport();
}

/**
 * Descarga el libro de Excel que arma el backend. El endpoint exige el token
 * Bearer, así que no sirve un `<a href>` directo: hay que pedirlo con
 * `apiFetch` y disparar la descarga desde un blob.
 *
 * Se exporta lo que el usuario tiene en pantalla — mismo rango de fechas y,
 * si hay filtros activos, sólo las campañas filtradas.
 */
async function exportExcel() {
  exporting.value = true;
  exportMsg.value = '';
  try {
    const params = new URLSearchParams();
    const from = rangeFrom();
    if (from) params.set('from', from.toISOString());
    const all = report.value?.campaigns || [];
    if (filteredCampaigns.value.length && filteredCampaigns.value.length < all.length) {
      params.set('campaignIds', filteredCampaigns.value.map((c) => c.id).join(','));
    }

    const res = await apiFetch(`/api/campaigns/performance/export?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo generar el Excel.');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filenameFromResponse(res) || `campanas-meta-ads-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    exportMsg.value = `No se pudo exportar: ${err.message}`;
  } finally {
    exporting.value = false;
  }
}

/** Nombre del archivo que propone el backend en `Content-Disposition`. */
function filenameFromResponse(res) {
  const header = res.headers.get('Content-Disposition') || '';
  return header.match(/filename="?([^"]+)"?/)?.[1] || null;
}

async function loadMetaStatus() {
  try {
    const res = await apiFetch('/api/campaigns/meta/status');
    if (res.ok) metaStatus.value = await res.json();
  } catch { /* silencioso: el banner de config se muestra solo si hay respuesta */ }
}

async function loadTikTokStatus() {
  try {
    const res = await apiFetch('/api/campaigns/tiktok/status');
    if (res.ok) tiktokStatus.value = await res.json();
  } catch { /* silencioso: igual que el de Meta */ }
}

/** Ventana de insights que se le pide a Meta según el rango en pantalla. */
const PRESET_BY_RANGE = { [TODAY_RANGE]: 'today', 7: 'last_7d', 30: 'last_30d', 90: 'last_90d', 0: 'maximum' };

async function syncMeta() {
  syncing.value = true;
  syncMsg.value = '';
  syncError.value = false;
  try {
    const res = await apiFetch('/api/campaigns/meta/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datePreset: PRESET_BY_RANGE[rangeDays.value] || 'last_30d' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo sincronizar con Meta.');
    const s = data.summary;
    syncMsg.value = `✅ Meta: ${s.campaigns} campaña(s), ${s.adsMapped} anuncio(s) mapeado(s), ${s.insightsUpdated} con métricas`
      + `, ${s.adInsights || 0} fila(s) de rendimiento por anuncio.`
      + (s.errors?.length ? ` ⚠️ ${s.errors.join(' · ')}` : '');
    await loadReport();
  } catch (err) {
    syncError.value = true;
    syncMsg.value = `No se pudo sincronizar: ${err.message}`;
  } finally {
    syncing.value = false;
  }
}

/**
 * Misma ventana de tiempo que Meta, traducida a fechas por el backend: TikTok
 * no tiene presets, pero el panel se pide igual para que las dos plataformas
 * se comparen sobre el mismo rango.
 */
async function syncTikTok() {
  syncingTikTok.value = true;
  syncMsg.value = '';
  syncError.value = false;
  try {
    const res = await apiFetch('/api/campaigns/tiktok/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datePreset: PRESET_BY_RANGE[rangeDays.value] || 'last_30d' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo sincronizar con TikTok.');
    const s = data.summary;
    syncMsg.value = `✅ TikTok: ${s.campaigns} campaña(s), ${s.adgroups} grupo(s), ${s.ads} anuncio(s)`
      + `, ${s.insightsUpdated} con métricas, ${s.adInsights || 0} fila(s) de rendimiento por anuncio.`
      + (s.errors?.length ? ` ⚠️ ${s.errors.join(' · ')}` : '');
    await loadReport();
    await loadTikTokStatus();
  } catch (err) {
    syncError.value = true;
    syncMsg.value = `No se pudo sincronizar: ${err.message}`;
  } finally {
    syncingTikTok.value = false;
  }
}

/**
 * Abre el modal y compara: qué leads tiene cada formulario instantáneo de
 * TikTok contra los que están en el CRM. No escribe nada.
 */
async function openTikTokLeads() {
  showTikTokLeads.value = true;
  ttLeadsReport.value = null;
  ttLeadsError.value = '';
  ttLeadsLoading.value = true;
  try {
    const res = await apiFetch('/api/campaigns/tiktok/leads');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo consultar a TikTok.');
    ttLeadsReport.value = data;
  } catch (err) {
    ttLeadsError.value = err.message;
  } finally {
    ttLeadsLoading.value = false;
  }
}

/**
 * Trae al CRM los que faltan.
 *
 * Al terminar se recarga el reporte de Campañas: los leads recién importados
 * ya traen su `ad_id`, así que la trazabilidad de la campaña —que es lo que
 * estaba vacío— pasa a tener contactos sin que haya que recargar la página.
 */
async function importTikTokLeads() {
  ttLeadsImporting.value = true;
  ttLeadsError.value = '';
  try {
    const res = await apiFetch('/api/campaigns/tiktok/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron importar los leads.');
    ttLeadsReport.value = data;
    await loadReport();
  } catch (err) {
    ttLeadsError.value = err.message;
  } finally {
    ttLeadsImporting.value = false;
  }
}

function closeTikTokLeads() {
  showTikTokLeads.value = false;
  ttLeadsReport.value = null;
  ttLeadsError.value = '';
}

/**
 * Trazabilidad de una campaña en un modal: el recorrido de cada lead agrupado
 * por el anuncio del que llegó. Se apoya en `sampleContacts`, que ya viene en
 * el informe, así que no hace falta pedir nada más al abrirlo — sólo las
 * miniaturas de los creativos, que sí son una petición por anuncio.
 */
function openTrace(campaign) {
  traceCampaign.value = campaign;
  hydrateAdImages(campaign);
}

function closeTrace() {
  traceCampaign.value = null;
}

/** Leads de la campaña abierta, agrupados por anuncio de procedencia. */
const traceGroups = computed(() => {
  const leads = traceCampaign.value?.sampleContacts || [];
  const groups = new Map();
  for (const lead of leads) {
    // Un anuncio que ya no está en las métricas (o un referral sin mapear)
    // sigue siendo un grupo propio: su id es lo único que lo identifica.
    const key = lead.adId || lead.adSourceId || 'sin-anuncio';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        adId: lead.adId || null,
        adSourceId: lead.adSourceId || null,
        adName: lead.adName || 'Anuncio sin identificar',
        adsetName: lead.adsetName || null,
        adHeadline: lead.adHeadline || null,
        leads: [],
        won: 0
      });
    }
    const group = groups.get(key);
    group.leads.push(lead);
    if (lead.currentStage === 'ganado') group.won++;
  }
  return [...groups.values()].sort((a, b) => b.leads.length - a.leads.length);
});

/** Embudo de los leads listados, para leer el detalle en contexto. */
const traceSummary = computed(() => {
  const leads = traceCampaign.value?.sampleContacts || [];
  const count = (...stages) => leads.filter((l) => stages.includes(l.currentStage)).length;
  return [
    { key: 'total', label: 'Leads', count: leads.length },
    { key: 'respondido', label: 'En conversación', count: count('respondido') },
    { key: 'calificado', label: 'Calificados', count: count('calificado') },
    { key: 'cita_agendada', label: 'Con cita', count: count('cita_agendada') },
    { key: 'ganado', label: 'Ganados', count: count('ganado') },
    { key: 'perdido', label: 'Perdidos', count: count('perdido') }
  ];
});

const rangeLabel = computed(() => RANGE_OPTIONS.find((o) => o.value === rangeDays.value)?.label || '');

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id;
  if (expandedId.value == null) return;
  detailTab.value = 'crm';
  const campaign = (report.value?.campaigns || []).find((c) => c.id === expandedId.value);
  if (campaign) hydrateAdImages(campaign);
}

// ─────────────────────────── Campañas (CRUD) ──────────────────────────
function resetForm() {
  Object.assign(form, {
    name: '', platform: 'instagram', status: 'activa', objective: '',
    budgetTotal: '', spendToDate: '', currency: 'PEN',
    startDate: '', endDate: '', adSourceIds: '', notes: ''
  });
}

function openCreateModal(ad) {
  resetForm();
  editingId.value = null;
  modalError.value = '';
  if (ad && ad.sourceId) {
    form.name = ad.headline ? ad.headline.slice(0, 120) : `Anuncio ${ad.sourceId}`;
    form.platform = ad.platform || 'meta';
    form.adSourceIds = ad.sourceId;
  }
  showModal.value = true;
}

function openEditModal(campaign) {
  editingId.value = campaign.id;
  modalError.value = '';
  Object.assign(form, {
    name: campaign.name,
    platform: campaign.platform || 'meta',
    status: campaign.status || 'activa',
    objective: campaign.objective || '',
    budgetTotal: campaign.budgetTotal ?? '',
    spendToDate: campaign.spendToDate ?? '',
    currency: campaign.currency || 'PEN',
    startDate: campaign.startDate ? String(campaign.startDate).slice(0, 10) : '',
    endDate: campaign.endDate ? String(campaign.endDate).slice(0, 10) : '',
    adSourceIds: '',
    notes: campaign.notes || ''
  });
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function saveCampaign() {
  saving.value = true;
  modalError.value = '';
  try {
    const payload = {
      name: form.name, platform: form.platform, status: form.status,
      objective: form.objective, budgetTotal: form.budgetTotal || 0,
      spendToDate: form.spendToDate === '' ? null : form.spendToDate,
      currency: form.currency, startDate: form.startDate || null, endDate: form.endDate || null,
      notes: form.notes
    };
    const url = editingId.value ? `/api/campaigns/${editingId.value}` : '/api/campaigns';
    const method = editingId.value ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la campaña.');

    const campaignId = data.campaign.id;
    const ids = form.adSourceIds.split(',').map((s) => s.trim()).filter(Boolean);
    for (const adSourceId of ids) {
      await apiFetch(`/api/campaigns/${campaignId}/ads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adSourceId })
      });
    }
    showModal.value = false;
    await loadReport();
  } catch (err) {
    modalError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeCampaign(campaign) {
  if (!confirm(`¿Eliminar la campaña "${campaign.name}"? Los anuncios asociados quedarán sin clasificar.`)) return;
  try {
    const res = await apiFetch(`/api/campaigns/${campaign.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('No se pudo eliminar.');
    await loadReport();
  } catch (err) {
    alert(err.message);
  }
}

async function assignAd(ad) {
  const campaignId = assignSelection[ad.sourceId];
  if (!campaignId) return;
  try {
    const res = await apiFetch(`/api/campaigns/${campaignId}/ads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adSourceId: ad.sourceId, adLabel: ad.headline })
    });
    if (!res.ok) throw new Error('No se pudo asignar el anuncio.');
    assignSelection[ad.sourceId] = '';
    await loadReport();
  } catch (err) {
    alert(err.message);
  }
}

async function detachAd(mappingId) {
  if (!confirm('¿Quitar este anuncio de la campaña?')) return;
  try {
    const res = await apiFetch(`/api/campaigns/ads/${mappingId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('No se pudo quitar el anuncio.');
    await loadReport();
  } catch (err) {
    alert(err.message);
  }
}

// ───────────────────────────── Formateo ───────────────────────────────
function num(n) {
  return Number(n || 0).toLocaleString('es-PE');
}

/**
 * Un objeto que nunca se entregó no tiene métricas: Meta muestra "—", no 0.
 * Pintar un cero haría pensar que se midió y dio cero.
 */
function numOrDash(n) {
  return n != null ? num(n) : '—';
}

function money(n) {
  const value = Number(n || 0);
  return `S/ ${value.toLocaleString('es-PE', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Los porcentajes de Meta (CTR) ya llegan en puntos porcentuales. */
function pct(value) {
  return value != null ? `${value}%` : '—';
}

/** Ventana del informe de Meta ("Inicio/Fin del informe"). */
function reportWindowLabel(metrics) {
  if (!metrics.reportStart && !metrics.reportStop) return 'sin datos de Meta';
  return `${formatDate(metrics.reportStart)} – ${formatDate(metrics.reportStop)}`;
}

/** "Entrega de anuncios": `effective_status` del anuncio en Meta. */
const DELIVERY_META = {
  ACTIVE: { label: 'Activo', pill: 'pill-success' },
  PAUSED: { label: 'En pausa', pill: 'pill-warning' },
  ADSET_PAUSED: { label: 'Conjunto en pausa', pill: 'pill-warning' },
  CAMPAIGN_PAUSED: { label: 'Campaña en pausa', pill: 'pill-warning' },
  PENDING_REVIEW: { label: 'En revisión', pill: 'pill-info' },
  IN_PROCESS: { label: 'En proceso', pill: 'pill-info' },
  PENDING_BILLING_INFO: { label: 'Falta pago', pill: 'pill-warning' },
  DISAPPROVED: { label: 'Rechazado', pill: 'pill-danger' },
  WITH_ISSUES: { label: 'Con problemas', pill: 'pill-danger' },
  ARCHIVED: { label: 'Archivado', pill: 'pill-neutral' },
  DELETED: { label: 'Eliminado', pill: 'pill-neutral' },
  COMPLETED: { label: 'Finalizado', pill: 'pill-neutral' }
};
function deliveryLabel(status) {
  if (!status) return '—';
  return DELIVERY_META[status]?.label || status.toLowerCase().replace(/_/g, ' ');
}
function deliveryPillClass(status) { return DELIVERY_META[status]?.pill || 'pill-neutral'; }

/**
 * Las tres clasificaciones de Meta comparan el anuncio con los demás que
 * compiten por la misma audiencia. La etiqueta va abreviada porque la tabla
 * ya es muy ancha; el texto completo queda en el `title`.
 */
const RANKING_META = {
  above_average: { short: 'Encima', label: 'Por encima del promedio', pill: 'pill-success' },
  average: { short: 'Promedio', label: 'Promedio', pill: 'pill-info' },
  below_average_35: { short: '35% inf.', label: 'Por debajo del promedio (35% inferior de los anuncios)', pill: 'pill-warning' },
  below_average_20: { short: '20% inf.', label: 'Por debajo del promedio (20% inferior de los anuncios)', pill: 'pill-danger' },
  below_average_10: { short: '10% inf.', label: 'Por debajo del promedio (10% inferior de los anuncios)', pill: 'pill-danger' },
  unknown: { short: '—', label: 'Sin datos suficientes (Meta necesita al menos 500 impresiones)', pill: 'pill-neutral' }
};
/** Objetivo de optimización del conjunto, en la redacción del panel de Meta. */
const OPTIMIZATION_GOALS = {
  CONVERSATIONS: 'Conversaciones',
  LEAD_GENERATION: 'Clientes potenciales',
  QUALITY_LEAD: 'Clientes potenciales de calidad',
  LINK_CLICKS: 'Clics en el enlace',
  LANDING_PAGE_VIEWS: 'Visitas a la página',
  OFFSITE_CONVERSIONS: 'Conversiones',
  REACH: 'Alcance',
  IMPRESSIONS: 'Impresiones',
  POST_ENGAGEMENT: 'Interacción',
  PAGE_LIKES: 'Me gusta de la página',
  THRUPLAY: 'Reproducciones de video',
  PROFILE_VISIT: 'Visitas al perfil',
  APP_INSTALLS: 'Instalaciones de la app'
};

function optimizationGoalLabel(goal) {
  if (!goal) return '—';
  return OPTIMIZATION_GOALS[goal] || goal.toLowerCase().replace(/_/g, ' ');
}

/** Cuántos anuncios de la campaña cuelgan de un conjunto. */
function adCountForAdset(campaign, adsetId) {
  return (campaign.metaAds || []).filter((ad) => String(ad.adsetId) === String(adsetId)).length;
}

function rankLabel(value) { return RANKING_META[value]?.short || '—'; }
function rankTitle(value) { return RANKING_META[value]?.label || 'Sin datos suficientes'; }
function rankPillClass(value) { return RANKING_META[value]?.pill || 'pill-neutral'; }

function responseLabel(minutes) {
  if (minutes == null) return '—';
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function dateRangeLabel(campaign) {
  const start = campaign.startDate ? formatDate(campaign.startDate) : null;
  const end = campaign.endDate ? formatDate(campaign.endDate) : (campaign.status === 'activa' ? 'hoy' : null);
  if (start && end) return `${start} – ${end}`;
  if (start) return `desde ${start}`;
  return 'sin fechas';
}

function brandIconName(platform) {
  if (platform === 'instagram') return 'instagram';
  if (platform === 'facebook') return 'facebook';
  if (platform === 'whatsapp') return 'whatsapp';
  if (platform === 'tiktok') return 'tiktok';
  return 'meta';
}

/**
 * Cómo se llama el nivel intermedio de la jerarquía en cada plataforma: Meta
 * lo llama "conjunto de anuncios" y TikTok "grupo de anuncios". Es el mismo
 * dato (`campaign.metaAdsets`), sólo cambia la etiqueta.
 */
function groupNoun(campaign) {
  return campaign?.source === 'tiktok'
    ? { one: 'grupo', many: 'grupos', long: 'grupo de anuncios' }
    : { one: 'conjunto', many: 'conjuntos', long: 'conjunto de anuncios' };
}

function funnelBarWidth(funnel, stage) {
  const max = funnel[0]?.count || 1;
  const pct = Math.max((stage.count / max) * 100, stage.count > 0 ? 4 : 1.5);
  return `${pct}%`;
}

function dropoffLabel(prevStage, stage) {
  if (!prevStage.count) return '';
  return `${Math.round((stage.count / prevStage.count) * 100)}% avanza`;
}

const STATUS_META = {
  activa: { label: 'Activa', pill: 'pill-success' },
  pausada: { label: 'Pausada', pill: 'pill-warning' },
  finalizada: { label: 'Finalizada', pill: 'pill-neutral' }
};
function statusLabel(s) { return STATUS_META[s]?.label || s; }
function statusPillClass(s) { return STATUS_META[s]?.pill || 'pill-neutral'; }

const STAGE_META = {
  conversacion: { label: 'En conversación', pill: 'pill-neutral' },
  respondido: { label: 'Respondido', pill: 'pill-info' },
  calificado: { label: 'Calificado', pill: 'pill-info' },
  cita_agendada: { label: 'Cita agendada', pill: 'pill-warning' },
  ganado: { label: 'Ganado', pill: 'pill-success' },
  perdido: { label: 'Perdido', pill: 'pill-danger' }
};
function stageLabel(s) { return STAGE_META[s]?.label || s; }
function stagePillClass(s) { return STAGE_META[s]?.pill || 'pill-neutral'; }

function stepDotClass(lead, step, idx) {
  if (!step.isFinal) return 'is-done';
  if (lead.currentStage === 'ganado') return 'is-won';
  if (lead.currentStage === 'perdido') return 'is-lost';
  return 'is-current';
}

onMounted(() => {
  loadReport();
  loadMetaStatus();
  loadTikTokStatus();
});
</script>

<style scoped>
.campaigns-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  box-sizing: border-box;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.campaigns-subheading {
  max-width: 720px;
  margin-bottom: 0;
}
.campaigns-subheading code {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: var(--surface-2);
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
}

.campaigns-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.range-tabs {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 9999px;
  padding: 0.2rem;
}
.range-tab {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.35rem 0.8rem;
  border-radius: 9999px;
  cursor: pointer;
}
.range-tab.active {
  background: var(--bg-card-solid);
  color: var(--text-main);
  box-shadow: var(--shadow-sm);
}

.new-campaign-btn { white-space: nowrap; }
.sync-btn { white-space: nowrap; width: auto; }

.state-banner {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 1rem 1.25rem;
  font-size: 0.88rem;
  color: var(--text-muted);
}
.state-banner code {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: var(--surface-2);
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
}
.state-error { border-color: var(--accent-rose); color: var(--accent-rose); }
.state-ok { border-color: rgba(46, 125, 70, 0.4); color: var(--accent-emerald); }
.state-hint { border-style: dashed; }
.meta-connected { font-size: 0.8rem; padding: 0.65rem 1rem; }
.meta-connected .data-mono { opacity: 0.75; }

.meta-badge,
.tiktok-badge {
  display: inline-block;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #1877F2;
  background: rgba(24, 119, 242, 0.12);
  border: 1px solid rgba(24, 119, 242, 0.3);
  border-radius: 5px;
  padding: 0.1rem 0.35rem;
  margin-left: 0.4rem;
  vertical-align: middle;
}
/* El rojo de TikTok, para distinguir de un vistazo el origen de la campaña. */
.tiktok-badge {
  color: #EE1D52;
  background: rgba(238, 29, 82, 0.12);
  border-color: rgba(238, 29, 82, 0.3);
}
.state-detail { display: block; margin-top: 0.35rem; font-size: 0.74rem; opacity: 0.8; font-family: var(--font-mono); }

.export-btn { white-space: nowrap; }
.export-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.tiktok-connected { font-size: 0.8rem; padding: 0.65rem 1rem; }
.tiktok-connected .data-mono { opacity: 0.75; }

.sync-btn-tiktok { border-color: rgba(238, 29, 82, 0.35); }

.kpi-meta { border-color: rgba(24, 119, 242, 0.28); }
.metric-meta { background: rgba(24, 119, 242, 0.06); border-color: rgba(24, 119, 242, 0.2); }

/* Tira de conexiones activas */
.connections-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.conn-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.76rem;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  color: var(--text-sub);
  box-shadow: var(--shadow-sm);
}

.conn-pill .data-mono { opacity: 0.75; font-size: 0.72rem; }

.conn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-emerald);
  box-shadow: 0 0 6px var(--accent-emerald);
}

/* KPIs Hero (6 tarjetas principales) */
.kpi-hero-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
  gap: 0.85rem;
}

.kpi-hero {
  position: relative;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.kpi-hero:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.kpi-hero::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3.5px;
  background: var(--primary);
}

.kpi-hero.is-primary::before { background: var(--primary); }
.kpi-hero.is-cyan::before { background: var(--accent-cyan); }
.kpi-hero.is-amber::before { background: var(--accent-amber); }
.kpi-hero.is-emerald::before { background: var(--accent-emerald); }
.kpi-hero.is-rose::before { background: var(--accent-rose); }

.kpi-top-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.kpi-mini-badge {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-sub);
  white-space: nowrap;
}

.kpi-mini-badge.is-roas {
  background: rgba(46, 125, 70, 0.14);
  color: var(--accent-emerald);
}

/* Cajón secundario plegable de KPIs */
.kpi-secondary-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.kpi-drawer-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  width: 100%;
  padding: 0.65rem 1rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-sub);
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.kpi-drawer-toggle:hover,
.kpi-drawer-toggle.is-open {
  border-color: var(--border-strong);
  background: var(--bg-card-hover);
  color: var(--text-main);
}

.kpi-drawer-Chips {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 400;
  font-size: 0.76rem;
  color: var(--text-muted);
}

.kpi-inline-preview strong {
  color: var(--text-main);
  font-family: var(--font-mono);
}

.kpi-secondary-grid {
  padding: 0.85rem;
  background: var(--surface-1);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-lg);
}

/* Sub-pestañas dentro del detalle de campaña */
.detail-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color);
}

.detail-nav-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  background: var(--surface-2);
  padding: 0.25rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.detail-nav-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.8rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.detail-nav-tab:hover {
  color: var(--text-main);
}

.detail-nav-tab.is-active {
  background: var(--bg-card-solid);
  color: var(--text-main);
  box-shadow: var(--shadow-sm);
}

.detail-tab-count {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  padding: 0.05rem 0.38rem;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--primary);
}

.crm-overview-split {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 1.25rem;
  align-items: start;
}

.crm-funnel-card,
.crm-metrics-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem 1.15rem;
}

.col-density-btn {
  padding: 0.32rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-card-solid);
  color: var(--text-sub);
  font-family: var(--font-body);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.col-density-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

@media (max-width: 980px) {
  .crm-overview-split {
    grid-template-columns: 1fr;
  }
}

/* KPIs */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.85rem;
}
.kpi-tile {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 1rem 1.15rem;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.kpi-label { font-size: 0.76rem; color: var(--text-muted); }
.kpi-value { font-family: var(--font-heading); font-size: 1.5rem; font-weight: 700; color: var(--text-main); }
.kpi-sub { font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); }

/* Campañas — tabla compacta con fila expandible */
.campaigns-table-section { display: flex; flex-direction: column; gap: 1rem; }

.table-toolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 9999px;
  padding: 0.45rem 0.9rem;
  flex: 1 1 240px;
  min-width: 200px;
  max-width: 340px;
}
.search-icon { font-size: 0.85rem; opacity: 0.6; flex-shrink: 0; }
.search-input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.82rem;
  color: var(--text-main);
  width: 100%;
}
.search-clear {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.72rem;
  flex-shrink: 0;
}
.search-clear:hover { color: var(--accent-rose); }

.filter-select {
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  color: var(--text-main);
  border-radius: 9999px;
  padding: 0.45rem 0.9rem;
  font-size: 0.8rem;
  font-family: inherit;
}

.table-total { font-size: 0.78rem; color: var(--text-muted); margin-left: auto; white-space: nowrap; }

.campaigns-table th.col-campaign { min-width: 260px; }
.campaigns-table th.col-actions, .campaigns-table td.col-actions { text-align: right; white-space: nowrap; }
.campaigns-table td.data-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

.campaign-row { cursor: pointer; }

.campaign-identity { display: flex; align-items: center; gap: 0.65rem; }
.campaign-thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  flex-shrink: 0;
  background: var(--surface-2);
}
.campaign-thumb-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
}
.campaign-identity-text { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.campaign-name { font-family: var(--font-heading); font-weight: 700; font-size: 0.9rem; color: var(--text-main); }
.campaign-objective {
  font-size: 0.72rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.campaign-meta { font-size: 0.76rem; color: var(--text-muted); font-family: var(--font-mono); }

.icon-btn {
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  border-radius: 8px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
}
.icon-btn:hover { background: var(--surface-3); }
/* Campaña sin leads atribuidos: el botón sigue abriendo el modal, que explica
   por qué está vacío, pero se ve apagado para no invitar al clic. */
.icon-btn.is-muted { opacity: 0.45; }
.expand-btn { transition: transform 0.15s ease; }
.expand-btn.is-open { transform: rotate(180deg); }

.campaign-detail-row td { padding: 0; background: var(--surface-1); }
.campaign-detail {
  padding: 1.25rem 1.5rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

/* Paginación */
.table-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}
.page-btn {
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  color: var(--text-main);
  border-radius: 8px;
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: 0.9rem;
}
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-btn:not(:disabled):hover { background: var(--surface-3); }
.page-indicator { font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono); }
.page-size-select {
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  color: var(--text-main);
  border-radius: 8px;
  padding: 0.35rem 0.5rem;
  font-size: 0.78rem;
  font-family: inherit;
}

/* Embudo */
.funnel { display: flex; flex-direction: column; gap: 0.55rem; }
.funnel-row {
  display: grid;
  grid-template-columns: minmax(150px, 240px) 1fr 84px;
  align-items: center;
  gap: 0.75rem;
}
.funnel-label { font-size: 0.78rem; color: var(--text-sub); text-align: right; }
.funnel-bar-track {
  position: relative;
  height: 24px;
  background: var(--surface-2);
  border-radius: 4px;
  display: flex;
  align-items: center;
  margin-right: 3.5rem;
}
.funnel-bar-fill { height: 24px; background: var(--primary); border-radius: 4px; transition: width 0.4s ease; }
.funnel-bar-value {
  position: absolute;
  left: calc(100% + 0.5rem);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
}
.funnel-dropoff { font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); text-align: left; }
.funnel-dropoff-spacer { visibility: hidden; }

/* Métricas — un bloque por origen (Meta Ads / CRM) */
.metrics-block {
  margin-top: 1.2rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--border-color);
}
.metrics-block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.75rem;
}
.metrics-block-title { font-size: 0.84rem; font-weight: 700; color: var(--text-main); margin: 0; }
.metrics-block-note { font-size: 0.72rem; color: var(--text-muted); }
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.6rem;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.65rem;
}
.metric-label { font-size: 0.68rem; color: var(--text-muted); }
.metric-value { font-size: 0.95rem; font-weight: 700; color: var(--text-main); font-variant-numeric: tabular-nums; }
.metric-sub { font-size: 0.64rem; color: var(--text-muted); line-height: 1.25; }

/* Tabla de rendimiento por anuncio — 23 columnas como el informe de Meta, con
   el nombre del anuncio fijo a la izquierda al desplazarse en horizontal. */
.ads-insights-wrapper {
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card-solid);
}
.ads-insights-table { width: max-content; min-width: 100%; font-size: 0.74rem; }
.ads-insights-table th,
.ads-insights-table td { white-space: nowrap; padding: 0.45rem 0.65rem; vertical-align: top; }
.ads-insights-table th { font-size: 0.64rem; }
.ads-insights-table .col-ad-name {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-card-solid);
  border-right: 1px solid var(--border-color);
  max-width: 220px;
  white-space: normal;
}
.ad-row-identity { display: flex; align-items: flex-start; gap: 0.5rem; }
.ad-row-identity-text { min-width: 0; }
.ad-row-thumb {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  border: 1px solid var(--border-color);
  background: var(--bg-soft);
}
.ad-row-thumb-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  opacity: 0.45;
}
.ad-row-name { display: block; font-size: 0.76rem; color: var(--text-main); line-height: 1.3; }
.ad-row-sub { display: block; font-size: 0.64rem; color: var(--text-muted); font-family: var(--font-body); line-height: 1.25; }
.pill-xs { font-size: 0.66rem; padding: 0.05rem 0.4rem; }

/* Ad chips */
.ad-chips { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 1rem; }
.ad-chips-label { font-size: 0.75rem; color: var(--text-muted); }
.ad-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 9999px;
  padding: 0.2rem 0.35rem 0.2rem 0.7rem;
  font-size: 0.74rem;
  color: var(--text-sub);
}
.ad-chip-x { border: none; background: transparent; cursor: pointer; color: var(--text-muted); font-size: 0.7rem; }
.ad-chip-x:hover { color: var(--accent-rose); }
.ad-chips-empty { font-size: 0.74rem; color: var(--text-muted); font-style: italic; }

/* Trazabilidad (modal) */
.trace-head-text { display: flex; flex-direction: column; gap: 0.15rem; }
.trace-head-sub { font-size: 0.76rem; color: var(--text-muted); }
.trace-modal-body { gap: 1.25rem; }
.trace-hint { font-size: 0.8rem; color: var(--text-muted); }

/* Resumen del embudo, arriba del detalle */
.trace-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 0.5rem;
}
.trace-summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.6rem 0.7rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}
.trace-summary-value { font-size: 1.15rem; font-weight: 700; color: var(--text-main); font-family: var(--font-mono); }
.trace-summary-label { font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }

/* Cabecera del anuncio del que llegaron los leads del grupo */
.trace-ad-group { display: flex; flex-direction: column; gap: 0.75rem; }
.trace-ad-head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem 0.75rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius-md);
}
.trace-ad-thumb {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  border: 1px solid var(--border-color);
  background: var(--bg-soft);
}
.trace-ad-thumb-fallback { display: inline-flex; align-items: center; justify-content: center; opacity: 0.45; }
.trace-ad-text { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1; }
.trace-ad-name { font-size: 0.85rem; color: var(--text-main); }
.trace-ad-sub { font-size: 0.7rem; color: var(--text-muted); }
.trace-ad-count { font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; }
.trace-leads { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
.trace-lead {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem 1.1rem;
}
.trace-lead-header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.5rem; margin-bottom: 0.85rem; }
.trace-lead-name { font-size: 0.88rem; color: var(--text-main); }
.trace-lead-topic { font-size: 0.76rem; color: var(--text-muted); flex-basis: 100%; }
.trace-timeline { list-style: none; display: flex; flex-direction: column; }
.trace-step { display: flex; align-items: flex-start; gap: 0.65rem; position: relative; padding-bottom: 0.9rem; }
.trace-step:not(.is-last)::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 14px;
  bottom: -2px;
  width: 2px;
  background: var(--border-color);
}
.trace-step-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-top: 2px;
  flex-shrink: 0;
  background: var(--surface-4);
  border: 2px solid var(--bg-card-solid);
  box-shadow: 0 0 0 1px var(--border-color);
}
.trace-step-dot.is-done { background: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
.trace-step-dot.is-current { background: var(--accent-amber); box-shadow: 0 0 0 1px var(--accent-amber); }
.trace-step-dot.is-won { background: var(--accent-emerald); box-shadow: 0 0 0 1px var(--accent-emerald); }
.trace-step-dot.is-lost { background: var(--accent-rose); box-shadow: 0 0 0 1px var(--accent-rose); }
.trace-step-body { display: flex; flex-direction: column; gap: 0.1rem; }
.trace-step-label { font-size: 0.8rem; color: var(--text-main); }
.trace-step-time { font-size: 0.7rem; color: var(--text-muted); }

/* Sin clasificar */
.unclassified-section {
  background: var(--bg-card-solid);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-lg);
  padding: 1.35rem 1.5rem;
}
.unclassified-heading { font-family: var(--font-heading); font-size: 0.98rem; font-weight: 700; color: var(--text-main); }
.unclassified-hint { font-size: 0.78rem; color: var(--text-muted); margin: 0.4rem 0 1rem; }
.unclassified-list { display: flex; flex-direction: column; gap: 0.65rem; }
.unclassified-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
}
.unclassified-main { display: flex; align-items: center; gap: 0.6rem; }
.unclassified-title { display: block; font-size: 0.85rem; color: var(--text-main); }
.unclassified-id { display: block; font-size: 0.68rem; color: var(--text-muted); }
.unclassified-stats { display: flex; gap: 0.75rem; font-size: 0.74rem; color: var(--text-sub); font-family: var(--font-mono); }
.unclassified-actions { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.assign-select, .cmp-modal input, .cmp-modal select, .cmp-modal textarea {
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  color: var(--text-main);
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  font-size: 0.8rem;
  font-family: inherit;
}
.btn-mini { padding: 0.35rem 0.7rem !important; font-size: 0.76rem !important; width: auto !important; }

.generated-note { font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); text-align: right; }

/* Modal */
.cmp-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}
.cmp-modal {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7);
}
.cmp-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}
.cmp-modal-wide { max-width: 980px; }
.cmp-modal-head h3 { font-size: 1.05rem; font-weight: 700; color: var(--text-main); }
.cmp-modal-body { padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.85rem; }
.fld { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: var(--text-muted); }
.fld-row { display: flex; gap: 0.75rem; }
.fld-row .fld { flex: 1; }
.fld-narrow { max-width: 90px; }
.fld-help { font-size: 0.68rem; color: var(--text-muted); }
.fld-help code { font-family: var(--font-mono); }
.cmp-modal-error { color: var(--accent-rose); font-size: 0.8rem; }
.cmp-modal-actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 0.25rem; }

@media (max-width: 720px) {
  .campaigns-page { padding: 1rem; }
  .funnel-row { grid-template-columns: 1fr; gap: 0.3rem; }
  .funnel-label { text-align: left; }
  .funnel-bar-track { margin-right: 0; }
  .funnel-bar-value { position: static; margin-left: 0.5rem; }
  .fld-row { flex-direction: column; }
  .fld-narrow { max-width: none; }
}
</style>
