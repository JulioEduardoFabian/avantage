<template>
  <main class="container-fluid database-page-wrapper">
    <!-- Header de la Vista -->
    <header class="database-header">
      <div class="header-titles">
        <h2 class="section-heading">
          <span class="heading-icon">🗄️</span> Base de Datos — Registro de Prospectos y Leads
        </h2>
        <p class="section-subheading">
          Consulta, filtra y registra prospectos comerciales. Gestiona datos personales, formación universitaria, situación de tesis y origen de contacto.
        </p>
      </div>

      <div class="header-actions">
        <button class="btn-action-primary" @click="openCreateModal">
          <span class="btn-icon">👤+</span> Insertar Nuevo Prospecto
        </button>
        <button class="btn-action-secondary" @click="fetchLeads" :disabled="isLoading" title="Actualizar lista">
          <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
          {{ isLoading ? 'Cargando...' : 'Actualizar' }}
        </button>
      </div>
    </header>

    <!-- Métricas Rápidas -->
    <section class="database-stats-grid">
      <div class="stat-card">
        <div class="stat-icon-wrapper blue">👥</div>
        <div class="stat-info">
          <span class="stat-label">Total Prospectos</span>
          <span class="stat-value">{{ leads.length }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper green">📅</div>
        <div class="stat-info">
          <span class="stat-label">Registrados Hoy</span>
          <span class="stat-value">{{ registeredTodayCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper amber">👤</div>
        <div class="stat-info">
          <span class="stat-label">Sin asignar</span>
          <span class="stat-value">{{ unassignedCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper purple">🎓</div>
        <div class="stat-info">
          <span class="stat-label">Con Tesis Definida</span>
          <span class="stat-value">{{ withTopicCount }}</span>
        </div>
      </div>
    </section>

    <!-- Barra de Búsqueda y Filtro de Fecha (Referencia 1) -->
    <div class="table-toolbar-ref1">
      <div class="search-box-ref1">
        <span class="search-icon-ref1">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          class="search-input-ref1"
          placeholder="Buscar por nombre o teléfono..."
        />
        <button v-if="searchQuery" class="clear-btn-ref1" @click="searchQuery = ''">✕</button>
      </div>

      <div class="date-filter-box-ref1">
        <span class="calendar-icon-ref1">📅</span>
        <input
          v-model="dateFilter"
          type="date"
          class="date-input-ref1"
          title="Filtrar por fecha de registro"
        />
        <button v-if="dateFilter" class="clear-btn-ref1" @click="dateFilter = ''" title="Limpiar filtro de fecha">✕</button>
      </div>
    </div>

    <!-- Error Alert -->
    <div v-if="loadError" class="info-box alert-box">
      <h4>⚠️ Error al cargar datos</h4>
      <p>{{ loadError }}</p>
    </div>

    <!-- Tabla Principal de Prospectos (Referencia 1) -->
    <div class="database-table-card custom-scrollbar">
      <table class="leads-ref-table">
        <thead>
          <tr>
            <th class="th-name">NOMBRE / TELÉFONO</th>
            <th class="th-assigned">ASIGNADO A</th>
            <th class="th-date">FECHA DE REGISTRO</th>
            <th class="th-options">OPCIONES</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lead in filteredLeads" :key="lead.id" class="lead-table-row">
            <!-- NOMBRE / TELÉFONO -->
            <td class="td-name">
              <div class="client-name-text">
                {{ formatDisplayName(lead) }}
              </div>
              <div class="client-phone-text">
                {{ formatDisplayPhone(lead.phone) }}
              </div>
            </td>

            <!-- ASIGNADO A -->
            <td class="td-assigned">
              <span class="assigned-pill">
                {{ lead.assigned_user_name || lead.assigned_to || 'Sin asignar' }}
              </span>
            </td>

            <!-- FECHA DE REGISTRO -->
            <td class="td-date">
              <span class="date-text">{{ formatTableDate(lead.created_at) }}</span>
            </td>

            <!-- OPCIONES (Botones de Referencia 1) -->
            <td class="td-options">
              <div class="options-btn-group">
                <!-- Botón Azul: Editar Prospecto -->
                <button
                  class="ref-icon-btn blue-edit"
                  @click="openEditModal(lead)"
                  title="Editar datos del prospecto"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>

                <!-- Botón Cian: Ver Ficha Completa -->
                <button
                  class="ref-icon-btn cyan-sheet"
                  @click="openDetailSheet(lead)"
                  title="Ver ficha completa / acciones"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                </button>

                <!-- Botón WhatsApp Rápido -->
                <a
                  v-if="lead.phone"
                  :href="'https://wa.me/' + normalizePhone(lead.phone)"
                  target="_blank"
                  rel="noopener"
                  class="ref-icon-btn green-wa"
                  title="Contactar por WhatsApp"
                >
                  💬
                </a>

                <!-- Botón Eliminar -->
                <button
                  class="ref-icon-btn red-delete"
                  @click="confirmDelete(lead)"
                  title="Eliminar prospecto"
                >
                  🗑️
                </button>
              </div>
            </td>
          </tr>

          <!-- Estado Vacío -->
          <tr v-if="filteredLeads.length === 0 && !isLoading">
            <td colspan="4" class="empty-table-cell">
              <div class="empty-table-state">
                <div class="empty-state-visual">
                  <img src="/images/empty_inbox.jpg" alt="Búsqueda de prospectos" class="empty-state-photo" />
                </div>
                <h4 class="empty-table-title">No se encontraron prospectos</h4>
                <p class="empty-table-desc">No hay registros que coincidan con la búsqueda o fecha seleccionada.</p>
                <button class="btn-action-secondary" @click="clearFilters">Limpiar Filtros</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL: INSERTAR / EDITAR PROSPECTO (Referencia 2 - 3 Columnas)     -->
    <!-- ================================================================= -->
    <div v-if="showFormModal" class="modal-overlay" @click.self="showFormModal = false">
      <div class="modal-content prospect-modal-container">
        <!-- Header del Modal -->
        <div class="modal-header prospect-modal-header">
          <div class="modal-title-group">
            <div class="modal-title-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
              </svg>
            </div>
            <div>
              <h3 class="prospect-modal-title">
                {{ isEditing ? 'Editar Prospecto' : 'Insertar Nuevo Prospecto' }}
              </h3>
              <p class="prospect-modal-subtitle">
                {{ isEditing ? 'Modifique los campos para actualizar la información' : 'Complete los campos para registrar un nuevo prospecto' }}
              </p>
            </div>
          </div>
          <button class="modal-close-btn" @click="showFormModal = false">✕</button>
        </div>

        <!-- Formulario en 3 Columnas (Referencia 2) -->
        <form @submit.prevent="saveProspect" class="modal-body custom-scrollbar prospect-form-body">
          <div class="prospect-three-columns-grid">
            
            <!-- ========================================== -->
            <!-- COLUMNA 1: 👤 Datos Personales            -->
            <!-- ========================================== -->
            <div class="form-section-card">
              <div class="section-card-header">
                <span class="section-header-icon">👤</span>
                <h4 class="section-card-title">Datos Personales</h4>
              </div>

              <div class="form-group-field">
                <label class="field-label">NOMBRE COMPLETO <span class="required-star">*</span></label>
                <div class="input-with-icon">
                  <span class="field-icon">👤</span>
                  <input
                    v-model="formData.fullName"
                    type="text"
                    class="field-input"
                    placeholder="Nombre del cliente"
                    required
                  />
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">NÚMERO DE CELULAR <span class="required-star">*</span></label>
                <div class="input-with-icon">
                  <span class="field-icon">📞</span>
                  <input
                    v-model="formData.phone"
                    type="text"
                    class="field-input"
                    placeholder="Ej. 987654321"
                    required
                  />
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">CORREO ELECTRÓNICO</label>
                <div class="input-with-icon">
                  <span class="field-icon">✉️</span>
                  <input
                    v-model="formData.email"
                    type="email"
                    class="field-input"
                    placeholder="correo@ejemplo.com"
                  />
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">DNI / DOC. IDENTIDAD</label>
                <div class="input-with-icon">
                  <span class="field-icon">🪪</span>
                  <input
                    v-model="formData.dni"
                    type="text"
                    class="field-input"
                    placeholder="Documento de identidad"
                    maxlength="15"
                  />
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">GÉNERO</label>
                <div class="input-with-icon">
                  <span class="field-icon">⚧</span>
                  <select v-model="formData.gender" class="field-select">
                    <option value="Masculino">Masculino</option>
                    <option value="Femenino">Femenino</option>
                    <option value="Otro">Otro</option>
                    <option value="Prefiero no decir">Prefiero no decir</option>
                  </select>
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">FECHA DE NACIMIENTO</label>
                <div class="input-with-icon">
                  <span class="field-icon">📅</span>
                  <input
                    v-model="formData.birthDate"
                    type="date"
                    class="field-input"
                  />
                </div>
              </div>
            </div>

            <!-- ========================================== -->
            <!-- COLUMNA 2: 📖 Datos Académicos             -->
            <!-- ========================================== -->
            <div class="form-section-card">
              <div class="section-card-header">
                <span class="section-header-icon">📖</span>
                <h4 class="section-card-title">Datos Académicos</h4>
              </div>

              <div class="form-group-field">
                <label class="field-label">UNIVERSIDAD</label>
                <div class="input-with-icon">
                  <span class="field-icon">🏛️</span>
                  <input
                    v-model="formData.university"
                    list="universities-list"
                    class="field-input"
                    placeholder="Seleccione o escriba universidad"
                  />
                  <datalist id="universities-list">
                    <option v-for="uni in PERU_UNIVERSITIES" :key="uni" :value="uni" />
                  </datalist>
                </div>
                <span class="field-helper">Seleccione de la lista desplegable o escriba otra</span>
              </div>

              <div class="form-group-field">
                <label class="field-label">CARRERA O MENCIÓN</label>
                <div class="input-with-icon">
                  <span class="field-icon">🎓</span>
                  <input
                    v-model="formData.career"
                    list="careers-list"
                    class="field-input"
                    placeholder="Seleccione o escriba carrera (mención)"
                  />
                  <datalist id="careers-list">
                    <option v-for="car in PERU_CAREERS" :key="car" :value="car" />
                  </datalist>
                </div>
                <span class="field-helper">Seleccione de la lista desplegable o escriba otra</span>
              </div>

              <div class="form-group-field">
                <label class="field-label">SITUACIÓN / TIPO DE TESIS</label>
                <div class="input-with-icon">
                  <span class="field-icon">📋</span>
                  <select v-model="formData.thesisSituation" class="field-select">
                    <option value="Tesis sin avance">Tesis sin avance</option>
                    <option value="Proyecto / Plan de Tesis">Proyecto / Plan de Tesis</option>
                    <option value="Borrador de Tesis (Capítulos 1-3)">Borrador de Tesis (Capítulos 1-3)</option>
                    <option value="Tesis Completa / En Revisión">Tesis Completa / En Revisión</option>
                    <option value="Levantamiento de Observaciones">Levantamiento de Observaciones</option>
                    <option value="Asesoría Estadística / Resultados">Asesoría Estadística / Resultados</option>
                    <option value="Artículo Científico">Artículo Científico</option>
                    <option value="Preparación para Sustentación">Preparación para Sustentación</option>
                  </select>
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">TEMA / IDEA DE INVESTIGACIÓN</label>
                <div class="input-with-icon">
                  <span class="field-icon">💡</span>
                  <input
                    v-model="formData.topic"
                    type="text"
                    class="field-input"
                    placeholder="Ej: Implementación de IA en gestión de inventarios"
                  />
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">ASIGNADO A</label>
                <div class="input-with-icon">
                  <span class="field-icon">💼</span>
                  <!--
                    La lista es el área comercial real (los usuarios con
                    acceso al funnel), no cuatro nombres escritos a mano: así
                    asignar desde acá deja la ficha igual que asignar desde la
                    tarjeta del tablero. Un nombre que ya estaba guardado y no
                    corresponde a ninguna cuenta se reagrega como opción para
                    no perderlo al guardar.
                  -->
                  <select v-model="formData.assignedTo" class="field-select">
                    <option value="">Sin asignar</option>
                    <option v-for="user in commercialTeam" :key="user.id" :value="user.name">
                      {{ user.name }}
                    </option>
                    <option
                      v-if="formData.assignedTo && !commercialTeam.some(u => u.name === formData.assignedTo)"
                      :value="formData.assignedTo"
                    >
                      {{ formData.assignedTo }} (registrado anteriormente)
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <!-- ========================================== -->
            <!-- COLUMNA 3: 📍 Ubicación y Origen           -->
            <!-- ========================================== -->
            <div class="form-section-card">
              <div class="section-card-header">
                <span class="section-header-icon">📍</span>
                <h4 class="section-card-title">Ubicación y Origen</h4>
              </div>

              <div class="form-group-field">
                <label class="field-label">DEPARTAMENTO</label>
                <div class="input-with-icon">
                  <span class="field-icon">🗺️</span>
                  <select v-model="formData.department" class="field-select" @change="onDepartmentChange">
                    <option value="">Selecciona Departamento</option>
                    <option v-for="dept in PERU_DEPARTMENTS" :key="dept" :value="dept">
                      {{ dept }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">PROVINCIA</label>
                <div class="input-with-icon">
                  <span class="field-icon">🧭</span>
                  <input
                    v-model="formData.province"
                    type="text"
                    class="field-input"
                    placeholder="Selecciona o escribe Provincia"
                  />
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">DIRECCIÓN</label>
                <div class="input-with-icon">
                  <span class="field-icon">🏠</span>
                  <input
                    v-model="formData.address"
                    type="text"
                    class="field-input"
                    placeholder="Dirección residencial"
                  />
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">ORIGEN / CANAL DE CONTACTO</label>
                <div class="input-with-icon">
                  <span class="field-icon">📡</span>
                  <select v-model="formData.source" class="field-select">
                    <option value="Chatbot Web">🤖 Chatbot Web</option>
                    <option value="WhatsApp Directo">💬 WhatsApp Directo</option>
                    <option value="Facebook Ads">📘 Facebook Ads</option>
                    <option value="Instagram Ads">📸 Instagram Ads</option>
                    <option value="TikTok">🎵 TikTok</option>
                    <option value="Instagram">📸 Instagram</option>
                    <option value="Referido">🤝 Referido</option>
                    <option value="Presencial">🏢 Presencial</option>
                    <option value="Base Fría">📞 Base Fría / Llamada</option>
                  </select>
                </div>
              </div>

              <div class="form-group-field">
                <label class="field-label">NOTAS ADICIONALES</label>
                <textarea
                  v-model="formData.additionalNotes"
                  class="field-textarea"
                  rows="2"
                  placeholder="Detalles sobre presupuesto, urgencia o requerimientos..."
                ></textarea>
              </div>
            </div>
          </div>

          <!-- Footer de Acciones del Modal -->
          <div class="prospect-modal-footer">
            <button type="button" class="btn-footer-cancel" @click="showFormModal = false">
              ✕ Cancelar
            </button>
            <button type="submit" class="btn-footer-submit" :disabled="isSubmitting">
              {{ isSubmitting ? 'Guardando...' : isEditing ? '💾 ACTUALIZAR PROSPECTO' : '✓ REGISTRAR PROSPECTO' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL: FICHA COMPLETA DEL PROSPECTO                               -->
    <!-- ================================================================= -->
    <div v-if="detailLead" class="modal-overlay" @click.self="detailLead = null">
      <div class="modal-content prospect-detail-drawer">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <span class="prospect-badge-id">ID #{{ detailLead.id }}</span>
            <span class="status-chip">{{ detailLead.status || 'nuevo' }}</span>
          </div>
          <button class="modal-close-btn" @click="detailLead = null">✕</button>
        </div>

        <div class="modal-body custom-scrollbar">
          <div class="drawer-client-header">
            <div class="drawer-avatar">
              {{ (detailLead.full_name || detailLead.topic || 'P').substring(0, 2).toUpperCase() }}
            </div>
            <div>
              <h3 class="drawer-name">{{ formatDisplayName(detailLead) }}</h3>
              <p class="drawer-assigned">Asignado a: <strong>{{ detailLead.assigned_user_name || detailLead.assigned_to || 'Sin asignar' }}</strong></p>
            </div>
          </div>

          <!-- Cuadrícula de Datos -->
          <div class="drawer-sections-grid">
            <div class="drawer-card">
              <h5>👤 Contacto</h5>
              <div class="drawer-row"><span class="lbl">Teléfono:</span> <span class="val selectable">{{ detailLead.phone || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Email:</span> <span class="val selectable">{{ detailLead.email || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">DNI:</span> <span class="val selectable">{{ detailLead.dni || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Género:</span> <span class="val">{{ detailLead.gender || '—' }}</span></div>
            </div>

            <div class="drawer-card">
              <h5>🎓 Académico</h5>
              <div class="drawer-row"><span class="lbl">Universidad:</span> <span class="val">{{ detailLead.university || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Carrera:</span> <span class="val">{{ detailLead.field_of_study || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Situación:</span> <span class="val">{{ detailLead.thesis_situation || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Nivel:</span> <span class="val">{{ detailLead.academic_level || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Grado actual:</span> <span class="val">{{ detailLead.academic_status || '—' }}{{ detailLead.academic_cycle ? ` · ${detailLead.academic_cycle}.º ciclo` : '' }}</span></div>
            </div>

            <div class="drawer-card">
              <h5>📍 Ubicación & Origen</h5>
              <div class="drawer-row"><span class="lbl">Departamento:</span> <span class="val">{{ detailLead.department || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Provincia:</span> <span class="val">{{ detailLead.province || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Dirección:</span> <span class="val">{{ detailLead.address || '—' }}</span></div>
              <div class="drawer-row"><span class="lbl">Canal:</span> <span class="val">{{ detailLead.source || '—' }}</span></div>
            </div>
          </div>

          <div v-if="detailLead.topic" class="drawer-topic-box">
            <h5>💡 Tema / Idea de Investigación</h5>
            <p>{{ detailLead.topic }}</p>
          </div>

          <div v-if="detailLead.additional_notes" class="drawer-topic-box">
            <h5>📝 Notas Adicionales</h5>
            <p>{{ detailLead.additional_notes }}</p>
          </div>

          <div v-if="detailLead.project_id" class="drawer-project-box">
            <span>🚀 Proyecto Activo #{{ detailLead.project_id }} ({{ detailLead.project_status }})</span>
            <router-link :to="`/admin/projects/${detailLead.project_id}`" class="btn-action-primary" style="font-size: 0.78rem; padding: 0.35rem 0.8rem; text-decoration: none;">
              Ver Proyecto
            </router-link>
          </div>

          <!-- Acciones Rápidas -->
          <div class="drawer-actions-bar">
            <a
              v-if="detailLead.phone"
              :href="'https://wa.me/' + normalizePhone(detailLead.phone)"
              target="_blank"
              rel="noopener"
              class="btn-action-secondary"
              style="text-decoration: none;"
            >
              💬 WhatsApp
            </a>
            <a
              v-if="detailLead.email"
              :href="'mailto:' + detailLead.email"
              class="btn-action-secondary"
              style="text-decoration: none;"
            >
              ✉️ Enviar Correo
            </a>
            <button
              class="btn-action-primary"
              @click="openEditFromDetail"
            >
              ✏️ Editar Datos
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { apiFetch } from '../apiClient.js';
import { careerNames } from '../data/careers.js';
import { commercialTeam, loadCommercialTeam } from '../data/commercialTeam.js';

// Universidades representativas de Perú
const PERU_UNIVERSITIES = [
  'UNCP - Universidad Nacional del Centro del Perú',
  'PUCP - Pontificia Universidad Católica del Perú',
  'UNMSM - Universidad Nacional Mayor de San Marcos',
  'UNI - Universidad Nacional de Ingeniería',
  'Universidad Continental',
  'UPN - Universidad Privada del Norte',
  'UTP - Universidad Tecnológica del Perú',
  'UCSUR - Universidad Científica del Sur',
  'USIL - Universidad San Ignacio de Loyola',
  'URP - Universidad Ricardo Palma',
  'UNFV - Universidad Nacional Federico Villarreal',
  'UCV - Universidad César Vallejo',
  'UNSA - Universidad Nacional de San Agustín (Arequipa)',
  'UNSCH - Universidad Nacional San Cristóbal de Huamanga',
  'UNSAAC - Universidad Nacional de San Antonio Abad del Cusco',
  'UNAP - Universidad Nacional del Altiplano (Puno)',
  'UNHEVAL - Universidad Nacional Hermilio Valdizán (Huánuco)'
];

/** El datalist de carreras sale del catálogo compartido (permite escribir otra). */
const PERU_CAREERS = careerNames;

const PERU_DEPARTMENTS = [
  'Junín', 'Lima', 'Arequipa', 'Cusco', 'La Libertad', 'Lambayeque',
  'Piura', 'Puno', 'Huánuco', 'Ancash', 'Ica', 'Ayacucho', 'Cajamarca',
  'San Martín', 'Loreto', 'Ucayali', 'Tacna', 'Moquegua', 'Pasco',
  'Huancavelica', 'Apurímac', 'Amazonas', 'Tumbes', 'Madre de Dios'
];

// Estado
const leads = ref([]);
const isLoading = ref(false);
const loadError = ref('');
const isSubmitting = ref(false);

// Filtros
const searchQuery = ref('');
const dateFilter = ref('');

// Modales
const showFormModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const detailLead = ref(null);

const formData = reactive({
  fullName: '',
  phone: '',
  email: '',
  dni: '',
  gender: 'Masculino',
  birthDate: '',
  university: '',
  career: '',
  thesisSituation: 'Tesis sin avance',
  topic: '',
  assignedTo: '',
  department: '',
  province: '',
  address: '',
  source: 'Chatbot Web',
  additionalNotes: ''
});

// Resúmenes y Estadísticas
const registeredTodayCount = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  return leads.value.filter(l => (l.created_at || '').slice(0, 10) === today).length;
});

/*
 * Leads que nadie tiene a su cargo. Antes este recuadro decía "Asignados a
 * Kevin" y contaba como suyos los que no tenían nada escrito, de cuando el
 * campo era texto libre con "Kevin" por defecto. Ahora que el responsable se
 * elige de verdad, el dato que importa es el contrario: a cuántos leads no los
 * está trabajando nadie.
 */
const unassignedCount = computed(() => {
  return leads.value.filter(l => !l.assigned_user_name && !l.assigned_to).length;
});

const withTopicCount = computed(() => {
  return leads.value.filter(l => Boolean(l.topic && l.topic !== 'Asesoría de Tesis')).length;
});

// Filtrado de Leads (Referencia 1)
const filteredLeads = computed(() => {
  let list = leads.value;

  // Filtro por texto (Nombre, Teléfono, Email, DNI, Universidad)
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter(l => {
      const name = (l.full_name || l.topic || '').toLowerCase();
      const phone = (l.phone || '').toLowerCase();
      const email = (l.email || '').toLowerCase();
      const dni = (l.dni || '').toLowerCase();
      const uni = (l.university || '').toLowerCase();
      const assigned = (l.assigned_to || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || email.includes(q) || dni.includes(q) || uni.includes(q) || assigned.includes(q);
    });
  }

  // Filtro por Fecha de Registro (YYYY-MM-DD)
  if (dateFilter.value) {
    list = list.filter(l => (l.created_at || '').slice(0, 10) === dateFilter.value);
  }

  return list;
});

// API Calls
async function fetchLeads() {
  isLoading.value = true;
  loadError.value = '';
  try {
    const res = await apiFetch('/api/leads');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar los prospectos.');
    leads.value = data.leads || [];
  } catch (err) {
    loadError.value = err.message;
  } finally {
    isLoading.value = false;
  }
}

function openCreateModal() {
  isEditing.value = false;
  editingId.value = null;
  resetForm();
  showFormModal.value = true;
}

function openEditModal(lead) {
  isEditing.value = true;
  editingId.value = lead.id;
  formData.fullName = lead.full_name || lead.topic || '';
  formData.phone = lead.phone || '';
  formData.email = lead.email || '';
  formData.dni = lead.dni || '';
  formData.gender = lead.gender || 'Masculino';
  formData.birthDate = lead.birth_date ? lead.birth_date.slice(0, 10) : '';
  formData.university = lead.university || '';
  formData.career = lead.field_of_study || '';
  formData.thesisSituation = lead.thesis_situation || 'Tesis sin avance';
  formData.topic = lead.topic || '';
  formData.assignedTo = lead.assigned_user_name || lead.assigned_to || '';
  formData.department = lead.department || '';
  formData.province = lead.province || '';
  formData.address = lead.address || '';
  formData.source = lead.source || 'Chatbot Web';
  formData.additionalNotes = lead.additional_notes || '';
  showFormModal.value = true;
}

function openDetailSheet(lead) {
  detailLead.value = lead;
}

function openEditFromDetail() {
  const l = detailLead.value;
  detailLead.value = null;
  if (l) openEditModal(l);
}

function resetForm() {
  formData.fullName = '';
  formData.phone = '';
  formData.email = '';
  formData.dni = '';
  formData.gender = 'Masculino';
  formData.birthDate = '';
  formData.university = '';
  formData.career = '';
  formData.thesisSituation = 'Tesis sin avance';
  formData.topic = '';
  formData.assignedTo = '';
  formData.department = 'Junín';
  formData.province = 'Huancayo';
  formData.address = '';
  formData.source = 'Chatbot Web';
  formData.additionalNotes = '';
}

function onDepartmentChange() {
  if (formData.department === 'Junín') formData.province = 'Huancayo';
  else if (formData.department === 'Lima') formData.province = 'Lima';
  else if (formData.department === 'Arequipa') formData.province = 'Arequipa';
  else if (formData.department === 'Cusco') formData.province = 'Cusco';
  else if (formData.department === 'La Libertad') formData.province = 'Trujillo';
  else formData.province = '';
}

async function saveProspect() {
  if (!formData.fullName.trim() || !formData.phone.trim()) {
    alert('Por favor ingrese el nombre completo y el número de celular.');
    return;
  }

  isSubmitting.value = true;
  try {
    const payload = {
      fullName: formData.fullName.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      dni: formData.dni.trim(),
      gender: formData.gender,
      birthDate: formData.birthDate || null,
      university: formData.university.trim(),
      fieldOfStudy: formData.career.trim(),
      thesisSituation: formData.thesisSituation,
      topic: formData.topic.trim() || `Asesoría para ${formData.fullName.trim()}`,
      assignedTo: formData.assignedTo,
      department: formData.department,
      province: formData.province,
      address: formData.address.trim(),
      source: formData.source,
      additionalNotes: formData.additionalNotes.trim()
    };

    let res;
    if (isEditing.value && editingId.value) {
      res = await apiFetch(`/api/leads/${editingId.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await apiFetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar el prospecto.');

    showFormModal.value = false;
    await fetchLeads();
  } catch (err) {
    alert('No se pudo guardar el prospecto: ' + err.message);
  } finally {
    isSubmitting.value = false;
  }
}

async function confirmDelete(lead) {
  const name = formatDisplayName(lead);
  if (!confirm(`¿Estás seguro de eliminar al prospecto "${name}"?`)) return;

  try {
    const res = await apiFetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar el prospecto.');
    await fetchLeads();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function clearFilters() {
  searchQuery.value = '';
  dateFilter.value = '';
}

// Formateadores
function formatDisplayName(lead) {
  if (lead.full_name) return lead.full_name.toUpperCase();
  if (lead.topic) return lead.topic.toUpperCase();
  return `PROSPECTO #${lead.id}`;
}

function formatDisplayPhone(phone) {
  if (!phone) return '—';
  return phone;
}

function formatTableDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

onMounted(() => {
  fetchLeads();
  // El desplegable de "Asignado a" se llena con el área comercial real.
  loadCommercialTeam().catch((error) => console.warn('No se pudo cargar el área comercial:', error));
});
</script>

<style scoped>
.database-page-wrapper {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

/* Header */
.database-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 1.25rem;
}

.heading-icon {
  display: inline-block;
  transform: translateY(-2px);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn-action-primary {
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  color: #ffffff;
  border: 1px solid var(--surface-4);
  border-radius: 10px;
  padding: 0.6rem 1.2rem;
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 14px rgba(111, 129, 37, 0.35);
  transition: all 0.2s ease;
}

.btn-action-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(111, 129, 37, 0.5);
  filter: brightness(1.1);
}

.btn-action-secondary {
  background: var(--surface-2);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.6rem 1.05rem;
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s ease;
}

.btn-action-secondary:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--surface-5);
}

.spin-animation {
  display: inline-block;
  animation: spin 1s linear infinite;
}

/* Grid de Métricas */
.database-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 1rem;
}

.stat-card {
  background: var(--bg-card);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 0.8rem 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: var(--surface-4);
}

.stat-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
}

.stat-icon-wrapper.blue { background: rgba(111, 129, 37, 0.15); border: 1px solid rgba(111, 129, 37, 0.3); }
.stat-icon-wrapper.green { background: rgba(46, 125, 70, 0.15); border: 1px solid rgba(46, 125, 70, 0.3); }
.stat-icon-wrapper.amber { background: rgba(201, 146, 46, 0.15); border: 1px solid rgba(201, 146, 46, 0.3); }
.stat-icon-wrapper.purple { background: rgba(111, 129, 37, 0.15); border: 1px solid rgba(111, 129, 37, 0.3); }

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text-main);
  font-family: var(--font-heading);
}

/* Barra de Búsqueda y Fecha (Referencia 1) */
.table-toolbar-ref1 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.search-box-ref1 {
  position: relative;
  flex: 1;
  min-width: 280px;
}

.search-icon-ref1 {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 0.9rem;
}

.search-input-ref1 {
  width: 100%;
  padding: 0.65rem 2.2rem 0.65rem 2.6rem;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  color: var(--text-main);
  font-size: 0.86rem;
  outline: none;
  transition: all 0.2s ease;
}

.search-input-ref1:focus {
  border-color: var(--primary);
  background: var(--bg-card-solid);
  box-shadow: 0 0 14px rgba(111, 129, 37, 0.25);
}

.clear-btn-ref1 {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.85rem;
}

.date-filter-box-ref1 {
  position: relative;
  display: flex;
  align-items: center;
}

.calendar-icon-ref1 {
  position: absolute;
  left: 0.9rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 0.9rem;
  pointer-events: none;
}

.date-input-ref1 {
  padding: 0.65rem 2.2rem 0.65rem 2.6rem;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  color: var(--text-main);
  font-size: 0.86rem;
  outline: none;
  color-scheme: dark;
  transition: all 0.2s ease;
}

.date-input-ref1:focus {
  border-color: var(--primary);
}

/* Tabla de Referencia 1 */
.database-table-card {
  background: var(--bg-card-solid);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  overflow-x: auto;
  box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45);
}

.leads-ref-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.leads-ref-table thead {
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-color);
}

.leads-ref-table th {
  padding: 1rem 1.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-family: var(--font-heading);
}

.th-name { width: 42%; }
.th-assigned { width: 20%; }
.th-date { width: 20%; }
.th-options { width: 18%; text-align: right; }

.lead-table-row {
  border-bottom: 1px solid var(--surface-2);
  transition: background 0.15s ease;
}

.lead-table-row:hover {
  background: var(--surface-1);
}

.leads-ref-table td {
  padding: 1.15rem 1.25rem;
  vertical-align: middle;
}

.client-name-text {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--accent-cyan);
  font-family: var(--font-heading);
  letter-spacing: 0.02em;
  line-height: 1.35;
  margin-bottom: 0.2rem;
}

.client-phone-text {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.assigned-pill {
  font-size: 0.85rem;
  color: var(--text-main);
  font-weight: 500;
}

.date-text {
  font-size: 0.84rem;
  color: var(--text-main);
  font-family: var(--font-mono);
}

.td-options {
  text-align: right;
}

.options-btn-group {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  justify-content: flex-end;
}

.ref-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.85rem;
  text-decoration: none;
  transition: all 0.2s ease;
}

.ref-icon-btn.blue-edit {
  background: #56624A;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(107, 122, 94, 0.4);
}

.ref-icon-btn.blue-edit:hover {
  background: #56621D;
  transform: translateY(-1px);
}

.ref-icon-btn.cyan-sheet {
  background: #2C8C99;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(158, 186, 75, 0.4);
}

.ref-icon-btn.cyan-sheet:hover {
  background: #2C8C99;
  transform: translateY(-1px);
}

.ref-icon-btn.green-wa {
  background: rgba(37, 211, 102, 0.2);
  border: 1px solid rgba(37, 211, 102, 0.4);
  color: #25D366;
}

.ref-icon-btn.green-wa:hover {
  background: #25D366;
  color: #0b2e21;
}

.ref-icon-btn.red-delete {
  background: rgba(200, 85, 50, 0.15);
  border: 1px solid rgba(200, 85, 50, 0.3);
  color: var(--accent-rose);
}

.ref-icon-btn.red-delete:hover {
  background: var(--accent-rose);
  color: #ffffff;
}

.empty-table-cell {
  text-align: center;
  padding: 2.5rem 1.5rem;
}

.empty-table-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
}

.empty-state-visual {
  width: 140px;
  height: 105px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 0.5rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
}

.empty-state-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.empty-table-title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 1rem;
  color: var(--text-main);
  margin: 0;
}

.empty-table-desc {
  font-size: 0.84rem;
  color: var(--text-muted);
  max-width: 400px;
  margin-bottom: 0.5rem;
}

/* ================================================================= */
/* MODAL: INSERTAR / EDITAR PROSPECTO (Referencia 2 - 3 Columnas)     */
/* ================================================================= */
.prospect-modal-container {
  max-width: 1040px;
  width: 95vw;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  max-height: 90vh;
  box-shadow: var(--shadow-lg);
}

.prospect-modal-header {
  padding: 1.25rem 1.75rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title-group {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.modal-title-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(111, 129, 37, 0.2);
  border: 1px solid rgba(111, 129, 37, 0.4);
  color: var(--accent-cyan);
  display: flex;
  align-items: center;
  justify-content: center;
}

.prospect-modal-title {
  font-family: var(--font-heading);
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
}

.prospect-modal-subtitle {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
}

.prospect-form-body {
  padding: 1.5rem 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Grid de 3 Columnas */
.prospect-three-columns-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1.25rem;
}

.form-section-card {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--surface-2);
}

.section-header-icon {
  font-size: 1.1rem;
  color: #9EBA4B;
}

.section-card-title {
  font-size: 0.92rem;
  font-weight: 700;
  color: #9EBA4B;
  font-family: var(--font-heading);
  margin: 0;
}

.form-group-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.required-star {
  color: var(--accent-rose);
}

.input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
}

.field-icon {
  position: absolute;
  left: 0.85rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  pointer-events: none;
}

.field-input, .field-select, .field-textarea {
  width: 100%;
  padding: 0.65rem 0.85rem 0.65rem 2.4rem;
  background: var(--surface-2);
  border: 1px solid var(--surface-3);
  border-radius: 10px;
  color: var(--text-main);
  font-size: 0.85rem;
  outline: none;
  color-scheme: dark;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.field-input:focus, .field-select:focus, .field-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 10px rgba(111, 129, 37, 0.3);
}

.field-textarea {
  padding: 0.65rem 0.85rem;
  resize: vertical;
}

.field-helper {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-style: italic;
}

/* Footer del Modal */
.prospect-modal-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.btn-footer-cancel {
  background: var(--surface-2);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.65rem 1.4rem;
  font-weight: 600;
  font-size: 0.86rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-footer-cancel:hover {
  background: var(--surface-3);
}

.btn-footer-submit {
  background: #56624A;
  color: #ffffff;
  border: none;
  border-radius: 10px;
  padding: 0.65rem 1.6rem;
  font-weight: 700;
  font-size: 0.86rem;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(107, 122, 94, 0.4);
  transition: all 0.2s ease;
}

.btn-footer-submit:hover:not(:disabled) {
  background: #56621D;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(107, 122, 94, 0.6);
}

/* Drawer / Ficha de Detalle */
.prospect-detail-drawer {
  max-width: 600px;
}

.prospect-badge-id {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--accent-cyan);
  background: rgba(111, 151, 199, 0.15);
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
}

.status-chip {
  font-size: 0.72rem;
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  text-transform: capitalize;
}

.drawer-client-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.drawer-avatar {
  width: 50px;
  height: 50px;
  border-radius: 14px;
  background: linear-gradient(135deg, #56624A, #6F8125);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: 800;
  font-family: var(--font-heading);
}

.drawer-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0 0 0.2rem 0;
}

.drawer-assigned {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
}

.drawer-sections-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
  margin-bottom: 1rem;
}

.drawer-card {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 0.85rem;
}

.drawer-card h5 {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 0.5rem 0;
}

.drawer-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  margin-bottom: 0.35rem;
  gap: 0.5rem;
}

.drawer-row .lbl {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.drawer-row .val {
  color: var(--text-main);
  text-align: right;
}

.drawer-row .selectable {
  user-select: all;
}

.drawer-topic-box {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 0.85rem;
  margin-bottom: 0.85rem;
}

.drawer-topic-box h5 {
  font-size: 0.78rem;
  color: var(--text-muted);
  text-transform: uppercase;
  margin: 0 0 0.35rem 0;
}

.drawer-topic-box p {
  font-size: 0.84rem;
  color: var(--text-sub);
  margin: 0;
}

.drawer-project-box {
  background: rgba(46, 125, 70, 0.12);
  border: 1px solid rgba(46, 125, 70, 0.35);
  border-radius: 12px;
  padding: 0.75rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  font-size: 0.84rem;
  color: var(--accent-emerald);
  font-weight: 600;
}

.drawer-actions-bar {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: 1rem;
}

@media (max-width: 960px) {
  .prospect-three-columns-grid {
    grid-template-columns: 1fr;
  }
  .drawer-sections-grid {
    grid-template-columns: 1fr;
  }
}
</style>
