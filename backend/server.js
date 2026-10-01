import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { OllamaService } from './services/ollamaService.js';
import { EmailService } from './services/emailService.js';
import { LeadService } from './services/leadService.js';
import { FunnelColumnService } from './services/funnelColumnService.js';
import { CareerCatalogService } from './services/careerCatalogService.js';
import { ProjectService } from './services/projectService.js';
import { TaskService } from './services/taskService.js';
import { TaskTemplateService } from './services/taskTemplateService.js';
import { QuoteService } from './services/quoteService.js';
import { ContractService } from './services/contractService.js';
import { ContractTemplateService } from './services/contractTemplateService.js';
import { buildContractDocument } from './services/contractDocument.js';
import { buildQuotationDocument } from './services/quotationDocument.js';
import { buildPaymentReceiptDocument } from './services/paymentReceiptDocument.js';
import { buildPaymentReceiptPdf, receiptPdfFilename } from './services/paymentReceiptPdf.js';
import { LeadNoteService } from './services/leadNoteService.js';
import { LeadStageChangeService } from './services/leadStageChangeService.js';
import { DocumentService } from './services/documentService.js';
import { CampaignService } from './services/campaignService.js';
import { MetaAdsService } from './services/metaAdsService.js';
import { TikTokAdsService } from './services/tiktokAdsService.js';
import { CampaignExportService } from './services/campaignExportService.js';
import { UserService } from './services/userService.js';
import { RoleService } from './services/roleService.js';
import { ProjectUpdateService } from './services/projectUpdateService.js';
import { DeliverableService } from './services/deliverableService.js';
import { MetaWebhookService } from './services/metaWebhookService.js';
import { runMetaLeadgenBackfill } from './scripts/backfillMetaLeadgenFields.js';
import { PageInteractionService } from './services/pageInteractionService.js';
import { PageMessageService } from './services/pageMessageService.js';
import { PageFollowerService } from './services/pageFollowerService.js';
import { WhatsappWebhookService } from './services/whatsappWebhookService.js';
import { YCloudWebhookService } from './services/ycloudWebhookService.js';
import { WhatsappMessageService } from './services/whatsappMessageService.js';
import { WhatsappBotService } from './services/whatsappBotService.js';
import { WhatsappBotSettingsService } from './services/whatsappBotSettingsService.js';
import { MetaEmbeddedSignupService } from './services/metaEmbeddedSignupService.js';
import { AdvisorAvailabilityService } from './services/advisorAvailabilityService.js';
import { InstagramService } from './services/instagramService.js';
import { InstagramWebhookService } from './services/instagramWebhookService.js';
import { GoogleCalendarService } from './services/googleCalendarService.js';
import { ScheduledMeetingService } from './services/scheduledMeetingService.js';
import { NotificationService } from './services/notificationService.js';
import { FinanceService } from './services/financeService.js';
import { FinanceLedgerService } from './services/financeLedgerService.js';
import { FinanceSalaryService } from './services/financeSalaryService.js';
import { ClientAccountService } from './services/clientAccountService.js';
import { buildAttachmentPreview, readImagePreviewBytes, resolveAttachmentKind } from './services/attachmentPreviewService.js';
import { signToken, requireAuth, requirePermission, requireAnyPermission, signGoogleOAuthState, verifyGoogleOAuthState, signClientToken, requireClientAuth } from './middleware/auth.js';

import { uploadProjectUpdateAttachment, uploadDir, uploadDeliverableAttachment, deliverableDir, uploadFinanceReceipt, uploadFinanceFile, uploadEmailAttachments, financeReceiptDir, whatsappMediaDir, campaignAdImageDir } from './middleware/upload.js';
import { db } from './db/connection.js';

// Estado del funnel Kanban que marca el fin del proceso comercial: al llegar
// aquí se genera automáticamente el proyecto asociado al lead.
const FUNNEL_FINAL_STATUS = 'ganado';

// Frecuencia del sondeo del conteo de seguidores de la página (Meta no lo
// notifica por webhook), 1 hora por defecto.
const FOLLOWER_POLL_INTERVAL_MS = Number(process.env.META_FOLLOWER_POLL_INTERVAL_MS) || 60 * 60 * 1000;

// Frecuencia del barrido de conversaciones inactivas de Avan (recordatorio
// a la 1h de silencio, "Congelado" a las 2h) — no necesita ser muy fino,
// los umbrales son de horas.
const STALE_CONVERSATION_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

dotenv.config();

// Red de seguridad: una promesa rechazada sin `catch` en cualquier parte (p.
// ej. un envío de WhatsApp que falla en un flujo en segundo plano) NO debe
// tumbar todo el servidor. Se registra y la app sigue corriendo.
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Server] Unhandled promise rejection (ignorada, el servidor sigue):', reason);
});
process.on('uncaughtException', (error) => {
  console.error('⚠️ [Server] Uncaught exception (ignorada, el servidor sigue):', error);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());


app.use((req, res, next) => {
  if (req.path.includes('webhooks/instagram') && req.method === 'POST') {
    console.log('content-length header:', req.headers['content-length']);
    console.log('content-type header:', req.headers['content-type']);
    console.log('transfer-encoding:', req.headers['transfer-encoding']);
  }
  next();
});


// Se conserva el body crudo (rawBody) para poder validar la firma
// X-Hub-Signature-256 de los webhooks de Meta.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Instanciar servicios
const ollamaService = new OllamaService();
const emailService = new EmailService();
const leadService = new LeadService();
const funnelColumnService = new FunnelColumnService();
const careerCatalogService = new CareerCatalogService();
const clientAccountService = new ClientAccountService();
const projectService = new ProjectService({ clientAccountService, emailService });
const taskService = new TaskService();
const taskTemplateService = new TaskTemplateService();
const quoteService = new QuoteService();
const contractTemplateService = new ContractTemplateService();
const leadNoteService = new LeadNoteService();
const leadStageChangeService = new LeadStageChangeService();
const campaignService = new CampaignService();
const metaAdsService = new MetaAdsService();
const tiktokAdsService = new TikTokAdsService();
const campaignExportService = new CampaignExportService({ campaignService });
const userService = new UserService();
const roleService = new RoleService();
const projectUpdateService = new ProjectUpdateService();
// Entregables: no tiene tablas propias, cruza las cuotas de Finanzas con los
// avances subidos. Usa projectService para no recalcular el avance de tareas ni
// la puerta del pago inicial por su cuenta.
const deliverableService = new DeliverableService({ projectService });
const metaWebhookService = new MetaWebhookService();
const pageInteractionService = new PageInteractionService();
const pageMessageService = new PageMessageService();
const pageFollowerService = new PageFollowerService();
const whatsappMessageService = new WhatsappMessageService();
const whatsappBotSettingsService = new WhatsappBotSettingsService();
const metaEmbeddedSignupService = new MetaEmbeddedSignupService();
const googleCalendarService = new GoogleCalendarService();
const scheduledMeetingService = new ScheduledMeetingService();
const notificationService = new NotificationService();
const financeService = new FinanceService();
const financeLedgerService = new FinanceLedgerService();
// La planilla de salarios es un registro aparte: no suma en ingresos ni egresos.
const financeSalaryService = new FinanceSalaryService();
// El cronograma de pagos del contrato son las cuotas reales de Finanzas.
const contractService = new ContractService({ financeLedgerService });
const documentService = new DocumentService({ quoteService, contractService });
const whatsappBotService = new WhatsappBotService({ ollamaService, emailService, leadService, whatsappMessageService, settingsService: whatsappBotSettingsService, googleCalendarService, scheduledMeetingService, notificationService });
const whatsappWebhookService = new WhatsappWebhookService({ botService: whatsappBotService });
const ycloudWebhookService = new YCloudWebhookService({ botService: whatsappBotService });
const advisorAvailabilityService = new AdvisorAvailabilityService();
const instagramService = new InstagramService();
const instagramWebhookService = new InstagramWebhookService();

// Historial en memoria de evaluaciones recientes

const evaluationHistory = [];

// API Endpoints

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Evaluador de Tesis Node.js + Ollama + Vue',
    timestamp: new Date().toISOString()
  });
});

/**
 * Login: valida credenciales y emite un JWT con los permisos del usuario
 * (rol → herramientas habilitadas: Panel de Leads, Proyectos, Roles y Permisos).
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });
    }

    const userRow = await userService.getUserByEmail(email.trim());
    if (!userRow) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const passwordMatches = await userService.verifyPassword(userRow, password);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const user = await userService.getUserWithPermissions(userRow.id);
    const token = signToken(user);

    console.log(`🔐 [Auth] Login exitoso: ${user.email} (${user.role})`);
    res.json({ token, user });
  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión.', details: error.message });
  }
});

/**
 * Devuelve el usuario autenticado actual (para restaurar sesión / validar token)
 */
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await userService.getUserWithPermissions(req.user.id);
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }
    // Los permisos viajan dentro del JWT (requirePermission no consulta la
    // DB). Si cambiaron desde el login —un permiso nuevo por migración o uno
    // asignado desde Roles—, se emite un token nuevo: si no, el panel mostraba
    // la sección (con los permisos frescos de aquí) y la API respondía 403
    // con los del token viejo. Solo se reemite cuando cambian, para no
    // alargar la sesión en cada carga.
    const tokenPermissions = [...(req.user.permissions || [])].sort().join(',');
    const currentPermissions = [...(user.permissions || [])].sort().join(',');
    res.json(tokenPermissions === currentPermissions ? { user } : { user, token: signToken(user) });
  } catch (error) {
    console.error('❌ Error al obtener el usuario actual:', error);
    res.status(500).json({ error: 'Error al obtener el usuario actual.', details: error.message });
  }
});

// =====================================================================
// PORTAL DE CLIENTES (/api/portal/*)
// =====================================================================
// Login separado del panel interno: namespace de JWT propio (signClientToken
// / requireClientAuth, `type: 'client'` en middleware/auth.js), así que un
// token de staff nunca sirve acá y viceversa. La identidad es el correo
// (projects.client_email); la cuenta nace sola al crearse el proyecto
// (ver projectService#inviteClientToPortal) y solo se activa con el token
// que llega por correo — nadie se auto-registra.

app.post('/api/portal/activar', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const account = await clientAccountService.activate(token, password);
    const clientToken = signClientToken(account);
    res.json({ token: clientToken, client: { id: account.id, email: account.email, name: account.name } });
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo activar la cuenta.' });
  }
});

app.post('/api/portal/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });
    }

    let account;
    try {
      account = await clientAccountService.authenticate(email, password);
    } catch (error) {
      return res.status(401).json({ error: error.message });
    }
    if (!account) return res.status(401).json({ error: 'Credenciales inválidas.' });

    const clientToken = signClientToken(account);
    res.json({ token: clientToken, client: { id: account.id, email: account.email, name: account.name } });
  } catch (error) {
    console.error('❌ Error en el login del portal de clientes:', error);
    res.status(500).json({ error: 'Error al iniciar sesión.', details: error.message });
  }
});

/**
 * Responde igual exista o no la cuenta, para no filtrar qué correos están
 * registrados en el portal.
 */
app.post('/api/portal/olvide-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (email) {
      const result = await clientAccountService.requestPasswordReset(email);
      if (result) {
        const resetUrl = `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/portal/restablecer?token=${result.resetToken}`;
        await emailService.sendClientPortalResetEmail(result.account.email, { name: result.account.name, resetUrl });
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al pedir el restablecimiento del portal de clientes:', error);
    res.json({ success: true });
  }
});

app.post('/api/portal/restablecer', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    await clientAccountService.resetPassword(token, password);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo restablecer la contraseña.' });
  }
});

app.get('/api/portal/me', requireClientAuth, (req, res) => {
  res.json({ client: { id: req.client.id, email: req.client.email, name: req.client.name } });
});

app.get('/api/portal/projects', requireClientAuth, async (req, res) => {
  try {
    const projects = await projectService.getProjectsByClientEmail(req.client.email);
    res.json({ projects });
  } catch (error) {
    console.error('❌ Error al obtener los proyectos del cliente:', error);
    res.status(500).json({ error: 'Error al obtener tus proyectos.', details: error.message });
  }
});

/**
 * Carga el proyecto pedido y confirma que sea del cliente autenticado. Si no
 * existe o no le pertenece, ya deja la respuesta lista (404/403) y devuelve
 * null — el caller solo debe cortar sin volver a responder.
 */
async function loadOwnedProject(req, res) {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Proyecto no encontrado.' });
    return null;
  }
  if (project.client_email !== req.client.email) {
    res.status(403).json({ error: 'No tienes acceso a este proyecto.' });
    return null;
  }
  return project;
}

app.get('/api/portal/projects/:id', requireClientAuth, async (req, res) => {
  try {
    const project = await loadOwnedProject(req, res);
    if (!project) return;

    const [tasks, updates, payments] = await Promise.all([
      taskService.getTasksByProject(project.id),
      projectUpdateService.getUpdatesByProject(project.id),
      financeLedgerService.listScheduleByLead(project.lead_id)
    ]);

    res.json({ project, tasks, updates, payments });
  } catch (error) {
    console.error('❌ Error al obtener el proyecto del cliente:', error);
    res.status(500).json({ error: 'Error al obtener el proyecto.', details: error.message });
  }
});

/**
 * Igual que `loadOwnedProject`, pero para el avance: confirma que la
 * actualización sea de un proyecto del cliente y que tenga adjunto. Deja la
 * respuesta 404 lista y devuelve null si no.
 */
async function loadOwnedUpdateAttachment(req, res) {
  const project = await loadOwnedProject(req, res);
  if (!project) return null;

  const update = await projectUpdateService.getUpdateById(req.params.updateId);
  if (!update || update.project_id !== project.id || !update.attachment_filename) {
    res.status(404).json({ error: 'Adjunto no encontrado.' });
    return null;
  }
  return update;
}

/**
 * Vista previa parcial del entregable. Se sirve esté bloqueado o no: es
 * justamente lo que el cliente puede mirar antes de pagar, para saber que el
 * avance existe y de qué va. El archivo completo sigue saliendo solo por
 * /attachment, y solo cuando Finanzas verificó la cuota.
 */
app.get('/api/portal/projects/:id/updates/:updateId/preview', requireClientAuth, async (req, res) => {
  try {
    const update = await loadOwnedUpdateAttachment(req, res);
    if (!update) return;

    const preview = await buildAttachmentPreview({
      filePath: path.join(uploadDir, update.attachment_filename),
      mimeType: update.attachment_mime_type,
      originalName: update.attachment_original_name
    });
    res.json({ preview });
  } catch (error) {
    console.error('❌ Error al armar la vista previa del adjunto:', error);
    res.status(500).json({ error: 'Error al generar la vista previa.', details: error.message });
  }
});

/**
 * Los primeros bytes de un adjunto que es imagen: el navegador dibuja la
 * franja de arriba y nada más. El resto del archivo no se manda, así que no
 * hay forma de reconstruir la imagen completa desde el portal.
 */
app.get('/api/portal/projects/:id/updates/:updateId/preview/image', requireClientAuth, async (req, res) => {
  try {
    const update = await loadOwnedUpdateAttachment(req, res);
    if (!update) return;

    const kind = resolveAttachmentKind(update.attachment_mime_type, update.attachment_original_name);
    if (kind !== 'image') return res.status(404).json({ error: 'Este adjunto no es una imagen.' });

    const bytes = await readImagePreviewBytes(path.join(uploadDir, update.attachment_filename));
    res.type(update.attachment_mime_type || 'image/jpeg').send(bytes);
  } catch (error) {
    console.error('❌ Error al servir la vista previa de la imagen:', error);
    res.status(500).json({ error: 'Error al generar la vista previa.', details: error.message });
  }
});

app.get('/api/portal/projects/:id/updates/:updateId/attachment', requireClientAuth, async (req, res) => {
  try {
    const update = await loadOwnedUpdateAttachment(req, res);
    if (!update) return;

    // El bloqueo también se aplica acá, no solo en la pantalla: el cliente ve
    // que el entregable existe, pero el archivo no sale del servidor hasta
    // que Finanzas verifique la cuota con la que se libera.
    if (update.is_locked) {
      return res.status(403).json({
        error: `Este documento se habilita cuando confirmemos el pago de la cuota ${update.unlock_cuota} ` +
          `(S/ ${Number(update.unlock_monto || 0).toFixed(2)}). Sube tu comprobante en la pestaña "Pagos".`,
        locked: true
      });
    }
    const filePath = path.join(uploadDir, update.attachment_filename);
    res.download(filePath, update.attachment_original_name || update.attachment_filename);
  } catch (error) {
    console.error('❌ Error al obtener el adjunto:', error);
    res.status(500).json({ error: 'Error al obtener el adjunto.', details: error.message });
  }
});

/**
 * El cliente solo adjunta comprobante a una cuota que el equipo ya registró
 * (misma tabla `finance_income` y el mismo ciclo pendiente → pagado →
 * verificado de Finanzas) — nunca declara un monto nuevo por su cuenta.
 */
app.post('/api/portal/projects/:id/payments/:incomeId/receipts', requireClientAuth, uploadFinanceReceipt, async (req, res) => {
  const vouchers = req.receipts || [];
  try {
    const project = await loadOwnedProject(req, res);
    if (!project) {
      vouchers.forEach((f) => financeLedgerService.discardUploadedFile(f));
      return;
    }

    const income = await financeLedgerService.getIncomeById(req.params.incomeId);
    if (!income || income.lead_id !== project.lead_id) {
      vouchers.forEach((f) => financeLedgerService.discardUploadedFile(f));
      return res.status(404).json({ error: 'Cuota no encontrada.' });
    }

    const receipts = await financeLedgerService.addIncomeReceipts(income.id, vouchers);

    try {
      await notificationService.create({
        type: 'client_payment_uploaded',
        title: `${project.topic}: comprobante subido por el cliente`,
        body: `${project.client_email} subió el comprobante de la cuota ${income.cuota} (S/ ${Number(income.monto).toFixed(2)}).`,
        link: '/admin/finance'
      });
    } catch (notifyError) {
      console.error('❌ Error al registrar la notificación del comprobante del cliente:', notifyError);
    }

    res.status(201).json({ receipts });
  } catch (error) {
    vouchers.forEach((f) => financeLedgerService.discardUploadedFile(f));
    console.error('❌ Error al subir el comprobante del cliente:', error);
    res.status(400).json({ error: error.message || 'Error al subir el comprobante.' });
  }
});

app.get('/api/portal/projects/:id/payments/:incomeId/receipts/:receiptId/file', requireClientAuth, async (req, res) => {
  try {
    const project = await loadOwnedProject(req, res);
    if (!project) return;

    const receipt = await financeLedgerService.getReceiptById(req.params.receiptId);
    if (!receipt || String(receipt.income_id) !== String(req.params.incomeId)) {
      return res.status(404).json({ error: 'Comprobante no encontrado.' });
    }
    const income = await financeLedgerService.getIncomeById(receipt.income_id);
    if (!income || income.lead_id !== project.lead_id) {
      return res.status(404).json({ error: 'Comprobante no encontrado.' });
    }
    sendFinanceFile(res, receipt.filename);
  } catch (error) {
    console.error('❌ Error al obtener el comprobante:', error);
    res.status(500).json({ error: 'Error al obtener el comprobante.', details: error.message });
  }
});

/**
 * Horario semanal de disponibilidad para reuniones del usuario autenticado
 * (cada quien configura únicamente el suyo).
 */
app.get('/api/availability/me', requireAuth, async (req, res) => {
  try {
    const slots = await advisorAvailabilityService.getByUser(req.user.id);
    res.json({ slots });
  } catch (error) {
    console.error('❌ Error al obtener la disponibilidad:', error);
    res.status(500).json({ error: 'Error al obtener la disponibilidad.', details: error.message });
  }
});

app.put('/api/availability/me', requireAuth, async (req, res) => {
  try {
    const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];
    const saved = await advisorAvailabilityService.replaceForUser(req.user.id, slots);
    res.json({ slots: saved });
  } catch (error) {
    console.error('❌ Error al guardar la disponibilidad:', error);
    res.status(500).json({ error: 'Error al guardar la disponibilidad.', details: error.message });
  }
});

/**
 * Estado de la conexión del usuario autenticado con su Google Calendar
 * (conectado/no conectado, y con qué correo si está conectado).
 */
app.get('/api/google/status', requireAuth, async (req, res) => {
  try {
    const configured = googleCalendarService.isConfigured();
    if (!configured) {
      return res.json({ configured: false, connected: false, email: null });
    }
    // Verifica que el token siga vivo (no solo que exista la fila), para que
    // el panel no muestre "Conectado" cuando en realidad Google ya revocó el
    // acceso — que es justo lo que hacía fallar al bot en silencio.
    const status = await googleCalendarService.verifyConnection(req.user.id);
    res.json({
      configured: true,
      connected: status.connected,
      email: status.email,
      needsReconnect: status.needsReconnect || false,
      warning: status.warning || null
    });
  } catch (error) {
    console.error('❌ Error al obtener el estado de Google Calendar:', error);
    res.status(500).json({ error: 'Error al obtener el estado de Google Calendar.', details: error.message });
  }
});

/**
 * URL de consentimiento de Google para que el usuario autenticado conecte su
 * propio Google Calendar. El frontend navega el navegador completo a esta
 * URL (no es una llamada fetch), por eso la identidad viaja en `state`.
 */
app.get('/api/google/auth-url', requireAuth, (req, res) => {
  try {
    if (!googleCalendarService.isConfigured()) {
      return res.status(400).json({ error: 'Google Calendar no está configurado en el servidor todavía.' });
    }
    const state = signGoogleOAuthState(req.user.id);
    const url = googleCalendarService.getAuthUrl(state);
    res.json({ url });
  } catch (error) {
    console.error('❌ Error al generar la URL de conexión con Google:', error);
    res.status(500).json({ error: 'Error al generar la URL de conexión con Google.', details: error.message });
  }
});

/**
 * Callback de Google tras el consentimiento. Es una redirección de
 * navegador plana (sin header Authorization), así que la identidad del
 * usuario se recupera validando el `state` firmado.
 */
app.get('/api/google/callback', async (req, res) => {
  const frontendBase = process.env.APP_BASE_URL || '';
  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      return res.redirect(`${frontendBase}/admin/availability?google=denied`);
    }
    if (!code || !state) {
      return res.redirect(`${frontendBase}/admin/availability?google=error`);
    }

    const userId = verifyGoogleOAuthState(state);
    await googleCalendarService.saveConnectionFromCode(userId, code);

    res.redirect(`${frontendBase}/admin/availability?google=connected`);
  } catch (error) {
    console.error('❌ Error en el callback de Google OAuth:', error);
    res.redirect(`${frontendBase}/admin/availability?google=error`);
  }
});

/**
 * Desconecta el Google Calendar del usuario autenticado (revoca el token en
 * Google y borra la conexión guardada).
 */
app.delete('/api/google/disconnect', requireAuth, async (req, res) => {
  try {
    await googleCalendarService.disconnect(req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al desconectar Google Calendar:', error);
    res.status(500).json({ error: 'Error al desconectar Google Calendar.', details: error.message });
  }
});

/**
 * Crea un evento de prueba (10 min de duración, empieza en 5 min) en el
 * Google Calendar del usuario autenticado, para confirmar que la conexión
 * realmente genera un link de Google Meet funcional.
 */
app.post('/api/google/test-event', requireAuth, async (req, res) => {
  try {
    const start = new Date(Date.now() + 5 * 60 * 1000);
    const end = new Date(start.getTime() + 10 * 60 * 1000);
    const event = await googleCalendarService.createMeetEvent(req.user.id, {
      summary: 'Prueba de conexión — Avantage Group',
      description: 'Evento de prueba generado desde el panel de Disponibilidad para confirmar la conexión con Google Meet.',
      startTime: start.toISOString(),
      endTime: end.toISOString()
    });
    res.json({ event });
  } catch (error) {
    console.error('❌ Error al crear el evento de prueba en Google Calendar:', error);
    res.status(500).json({ error: 'No se pudo crear el evento de prueba.', details: error.message });
  }
});

/**
 * Próximas reuniones que Avan agendó automáticamente por WhatsApp (registro
 * propio en `scheduled_meetings`, más rápido que consultar la API de Google
 * en vivo), para verlas dentro del panel sin salir a Google Calendar.
 */
app.get('/api/meetings/upcoming', requireAuth, async (req, res) => {
  try {
    const meetings = await scheduledMeetingService.getUpcoming();
    res.json({ meetings });
  } catch (error) {
    console.error('❌ Error al obtener las próximas reuniones:', error);
    res.status(500).json({ error: 'Error al obtener las próximas reuniones.', details: error.message });
  }
});

/**
 * Notificaciones internas del panel (campana del navbar): reuniones que
 * Avan agendó, y casos de leads con reunión ya agendada que necesitan que
 * un asesor intervenga (reagendar, queja, consulta nueva).
 */
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await notificationService.getRecent();
    res.json({ notifications });
  } catch (error) {
    console.error('❌ Error al obtener las notificaciones:', error);
    res.status(500).json({ error: 'Error al obtener las notificaciones.', details: error.message });
  }
});

app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount();
    res.json({ count });
  } catch (error) {
    console.error('❌ Error al obtener el conteo de notificaciones:', error);
    res.status(500).json({ error: 'Error al obtener el conteo de notificaciones.', details: error.message });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await notificationService.markRead(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al marcar la notificación como leída:', error);
    res.status(500).json({ error: 'Error al marcar la notificación como leída.', details: error.message });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await notificationService.markAllRead();
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al marcar las notificaciones como leídas:', error);
    res.status(500).json({ error: 'Error al marcar las notificaciones como leídas.', details: error.message });
  }
});

/**
 * Finanzas: registro de ingresos y egresos del negocio, con resumen para
 * los KPIs y gráficos del panel.
 */
app.get('/api/finance/transactions', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const { type, category, from, to, limit } = req.query;
    const transactions = await financeService.list({
      type,
      category,
      from,
      to,
      limit: limit ? Number(limit) : undefined
    });
    res.json({ transactions });
  } catch (error) {
    console.error('❌ Error al obtener las transacciones financieras:', error);
    res.status(500).json({ error: 'Error al obtener las transacciones financieras.', details: error.message });
  }
});

app.post('/api/finance/transactions', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const { type, category, description, amount, transactionDate, projectId } = req.body || {};
    const transaction = await financeService.create({
      type,
      category,
      description,
      amount,
      transactionDate,
      projectId,
      createdBy: req.user.id
    });
    res.status(201).json({ transaction });
  } catch (error) {
    console.error('❌ Error al registrar la transacción financiera:', error);
    res.status(400).json({ error: error.message || 'Error al registrar la transacción financiera.' });
  }
});

app.delete('/api/finance/transactions/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    await financeService.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar la transacción financiera:', error);
    res.status(500).json({ error: 'Error al eliminar la transacción financiera.', details: error.message });
  }
});

app.get('/api/finance/summary', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const summary = await financeService.getSummary();
    res.json(summary);
  } catch (error) {
    console.error('❌ Error al obtener el resumen financiero:', error);
    res.status(500).json({ error: 'Error al obtener el resumen financiero.', details: error.message });
  }
});

/**
 * Libro contable de Finanzas (pestañas INGRESOS, LIBRO DIARIO y GASTOS FIJOS).
 * Todo el módulo se controla con el permiso `finance.view`.
 */

/**
 * Sirve un archivo de `uploads/finance-receipts/`. Si la fila apunta a un
 * archivo que ya no está en disco (un despliegue que no conservó `uploads/`,
 * por ejemplo) responde un 404 explícito en vez de dejar que `res.sendFile`
 * falle a medias: así la UI puede avisar en lugar de quedarse cargando.
 */
function sendFinanceFile(res, filename, label = 'El comprobante') {
  const filePath = path.join(financeReceiptDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: `${label} ya no está en el servidor (el archivo se perdió).`,
      missingFile: true
    });
  }
  res.sendFile(filePath);
}
app.get('/api/finance/leads-directory', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const leads = await financeLedgerService.listLeadsDirectory();
    res.json({ leads });
  } catch (error) {
    console.error('❌ Error al obtener el directorio de leads de Finanzas:', error);
    res.status(500).json({ error: 'Error al obtener el directorio de leads.', details: error.message });
  }
});

/**
 * Fija o corrige el precio total del cierre de un lead, contra el que se
 * valida la suma de sus cuotas en Finanzas (ver `createIncome`/`updateIncome`).
 */
app.patch('/api/finance/leads/:id/total-amount', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const lead = await financeLedgerService.setLeadTotalAmount(req.params.id, req.body?.totalAmount);
    res.json({ lead });
  } catch (error) {
    console.error('❌ Error al actualizar el precio total del lead:', error);
    res.status(400).json({ error: error.message || 'Error al actualizar el precio total.' });
  }
});

// --- Ingresos ---
app.get('/api/finance/income', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const income = await financeLedgerService.listIncome();
    res.json({ income });
  } catch (error) {
    console.error('❌ Error al obtener los ingresos:', error);
    res.status(500).json({ error: 'Error al obtener los ingresos.', details: error.message });
  }
});

app.post('/api/finance/income', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const { fecha, dueDate, leadId, cuota, emitir, monto, banco, estado, tributario } = req.body || {};
    const record = await financeLedgerService.createIncome({
      fecha, dueDate, leadId, cuota, emitir, monto, banco, estado, tributario, createdBy: req.user.id
    });
    res.status(201).json({ income: record });
  } catch (error) {
    console.error('❌ Error al registrar el ingreso:', error);
    res.status(400).json({ error: error.message || 'Error al registrar el ingreso.' });
  }
});

app.put('/api/finance/income/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const { fecha, dueDate, leadId, cuota, emitir, monto, banco, estado, tributario } = req.body || {};
    const record = await financeLedgerService.updateIncome(req.params.id, {
      fecha, dueDate, leadId, cuota, emitir, monto, banco, estado, tributario
    });
    if (!record) return res.status(404).json({ error: 'Ingreso no encontrado.' });
    res.json({ income: record });
  } catch (error) {
    console.error('❌ Error al editar el ingreso:', error);
    res.status(400).json({ error: error.message || 'Error al editar el ingreso.' });
  }
});

app.patch('/api/finance/income/:id/estado', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const record = await financeLedgerService.updateIncomeEstado(req.params.id, req.body?.estado);
    if (!record) return res.status(404).json({ error: 'Ingreso no encontrado.' });
    res.json({ income: record });
  } catch (error) {
    console.error('❌ Error al actualizar el estado del ingreso:', error);
    res.status(400).json({ error: error.message || 'Error al actualizar el estado del ingreso.' });
  }
});

/**
 * Visto bueno de Finanzas sobre un ingreso. Es la única puerta que lo hace
 * sumar en las cifras del módulo y que desbloquea el proyecto del lead, así
 * que va detrás de su propio permiso (`finance.verify`), no del de ver.
 */
app.patch('/api/finance/income/:id/verificacion', requireAuth, requirePermission('finance.verify'), async (req, res) => {
  try {
    const verified = req.body?.verified !== false;
    const income = await financeLedgerService.setIncomeVerificacion(req.params.id, {
      verified,
      verifiedBy: req.user.id
    });
    if (!income) return res.status(404).json({ error: 'Ingreso no encontrado.' });

    // Un pago inicial verificado es lo que activa el proyecto del lead.
    let project = null;
    if (income.is_initial_payment) {
      project = await projectService.syncStatusWithPayment(income.lead_id, { verified });
      console.log(`💰 [Finanzas] Ingreso ${income.code} ${verified ? 'verificado' : 'sin verificar'}` +
        (project ? ` · proyecto #${project.id} → ${project.status}` : ''));
    }

    // Verificar la cuota es lo que libera los entregables atados a ella. El
    // aviso al cliente es un efecto secundario: si el correo falla, la
    // verificación ya quedó hecha y el documento ya está descargable.
    if (verified) notifyUnlockedDeliverables(income).catch(() => {});

    res.json({ income, project });
  } catch (error) {
    console.error('❌ Error al verificar el ingreso:', error);
    res.status(400).json({ error: error.message || 'Error al verificar el ingreso.' });
  }
});

/**
 * Avisa al cliente (correo + notificación interna) de que los avances que
 * esperaban esta cuota ya se pueden descargar de su portal. No lanza: es un
 * aviso, no parte de la verificación.
 */
async function notifyUnlockedDeliverables(income) {
  try {
    const project = income.lead_id ? await db('projects').where({ lead_id: income.lead_id }).first() : null;
    if (!project) return;

    const updates = await db('project_updates')
      .where({ project_id: project.id, income_id: income.id })
      .whereNotNull('attachment_filename')
      .select('attachment_original_name', 'content');
    if (updates.length === 0) return;

    const documents = updates.map((u) => u.attachment_original_name || u.content.slice(0, 60));

    await notificationService.create({
      type: 'deliverables_unlocked',
      title: `${project.topic}: entregables liberados`,
      // Sin el monto: es un aviso del módulo de proyectos, donde no se
      // muestran importes (el detalle del cobro está en Finanzas).
      body: `La cuota ${income.cuota} quedó verificada; ${documents.length} documento(s) ya son descargables por el cliente.`,
      link: `/admin/projects/${project.id}`
    });

    if (project.client_email) {
      await emailService.sendDeliverablesUnlockedEmail(project.client_email, {
        name: income.lead_name,
        projectTopic: project.topic,
        cuota: income.cuota,
        monto: income.monto,
        documents,
        portalUrl: `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/portal/proyectos/${project.id}`
      });
    }
  } catch (error) {
    console.error('❌ Error al avisar de los entregables liberados:', error.message);
  }
}

app.delete('/api/finance/income/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    await financeLedgerService.deleteIncome(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el ingreso:', error);
    res.status(500).json({ error: 'Error al eliminar el ingreso.', details: error.message });
  }
});

app.post('/api/finance/income/:id/receipts', requireAuth, requirePermission('finance.view'), uploadFinanceReceipt, async (req, res) => {
  try {
    const receipts = await financeLedgerService.addIncomeReceipts(req.params.id, req.receipts);
    res.status(201).json({ receipts, receipt: receipts[0] || null });
  } catch (error) {
    console.error('❌ Error al subir el comprobante del ingreso:', error);
    res.status(400).json({ error: error.message || 'Error al subir el comprobante.' });
  }
});

app.post('/api/finance/income/:id/tributario', requireAuth, requirePermission('finance.view'), uploadFinanceFile, async (req, res) => {
  try {
    const record = await financeLedgerService.setTributarioFile(req.params.id, req.file);
    res.status(201).json({ income: record });
  } catch (error) {
    console.error('❌ Error al subir el archivo tributario:', error);
    res.status(400).json({ error: error.message || 'Error al subir el archivo tributario.' });
  }
});

app.get('/api/finance/income/:id/tributario', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const income = await financeLedgerService.getIncomeById(req.params.id);
    if (!income || !income.tributario_filename) return res.status(404).json({ error: 'Archivo no encontrado.' });
    sendFinanceFile(res, income.tributario_filename, 'El archivo tributario');
  } catch (error) {
    console.error('❌ Error al obtener el archivo tributario:', error);
    res.status(500).json({ error: 'Error al obtener el archivo tributario.', details: error.message });
  }
});

app.delete('/api/finance/income/:id/tributario', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const record = await financeLedgerService.deleteTributarioFile(req.params.id);
    if (!record) return res.status(404).json({ error: 'Ingreso no encontrado.' });
    res.json({ income: record });
  } catch (error) {
    console.error('❌ Error al eliminar el archivo tributario:', error);
    res.status(500).json({ error: 'Error al eliminar el archivo tributario.', details: error.message });
  }
});

/**
 * Envía el archivo tributario de un ingreso al cliente por correo o WhatsApp.
 * Si no se indica `to`, se usa el correo/teléfono del lead asociado.
 */
app.post('/api/finance/income/:id/tributario/send', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const { channel, to, message } = req.body || {};
    const income = await financeLedgerService.getIncomeById(req.params.id);
    if (!income) return res.status(404).json({ error: 'Ingreso no encontrado.' });
    if (!income.tributario_filename) {
      return res.status(400).json({ error: 'Este ingreso no tiene un archivo tributario cargado.' });
    }

    const filePath = path.join(financeReceiptDir, income.tributario_filename);
    const filename = income.tributario_original_name || income.tributario_filename;

    if (channel === 'email') {
      const recipient = (to || '').trim() || income.lead_email;
      if (!recipient) {
        return res.status(400).json({ error: 'No hay un correo de destino (el lead no tiene correo registrado).' });
      }
      const result = await emailService.sendFileEmail(recipient, {
        subject: `Documento tributario — ${income.code}`,
        message,
        filePath,
        filename
      });
      if (!result.success) return res.status(502).json({ error: result.error || 'No se pudo enviar el correo.' });
      return res.json({ result: { ...result, channel: 'email' } });
    }

    if (channel === 'whatsapp') {
      const recipient = (to || '').trim() || income.lead_phone;
      if (!recipient) {
        return res.status(400).json({ error: 'No hay un número de destino (el lead no tiene teléfono registrado).' });
      }
      const sent = await whatsappMessageService.sendMediaMessage(recipient, {
        filePath,
        filename,
        mimeType: income.tributario_mime_type,
        caption: message
      });
      return res.json({ result: { success: true, channel: 'whatsapp', recipient, messageId: sent?.message_id || null } });
    }

    return res.status(400).json({ error: 'El canal debe ser "email" o "whatsapp".' });
  } catch (error) {
    console.error('❌ Error al enviar el archivo tributario:', error);
    res.status(502).json({ error: error.message || 'Error al enviar el archivo tributario.' });
  }
});

/**
 * Comprobante de pago imprimible de un ingreso VERIFICADO.
 *
 * Se exige la verificación —no basta con "pagado"— porque el comprobante es
 * lo que el cliente guarda como constancia: emitirlo antes de que Finanzas
 * revise el voucher sería certificar un pago que todavía nadie confirmó.
 */
function assertVerifiedIncome(income, res) {
  if (!income) {
    res.status(404).json({ error: 'Ingreso no encontrado.' });
    return false;
  }
  if (income.estado !== 'verificado') {
    res.status(409).json({ error: 'El comprobante solo se emite para un ingreso verificado por Finanzas.' });
    return false;
  }
  return true;
}

/**
 * Datos de contacto del cliente de un cierre, para verlos y corregirlos desde
 * Finanzas.
 *
 * Existe aparte de `/api/leads/:id` porque el permiso es otro: quien lleva la
 * caja no necesariamente puede entrar al funnel de ventas, y estos son los
 * datos que salen impresos en el comprobante que él mismo emite (nombre, DNI
 * y correo). Solo se tocan esos cuatro campos.
 */
app.get('/api/finance/leads/:id/contact', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const lead = await leadService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Cliente no encontrado.' });
    res.json({
      lead: {
        id: lead.id,
        full_name: lead.full_name,
        dni: lead.dni,
        email: lead.email,
        phone: lead.phone
      }
    });
  } catch (error) {
    console.error('❌ Error al obtener los datos del cliente:', error);
    res.status(500).json({ error: 'Error al obtener los datos del cliente.', details: error.message });
  }
});

app.patch('/api/finance/leads/:id/contact', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const { fullName, dni, email, phone } = req.body || {};
    const lead = await leadService.updateLead(req.params.id, { fullName, dni, email, phone });
    if (!lead) return res.status(404).json({ error: 'Cliente no encontrado.' });
    console.log(`✏️ [Finanzas] Datos de contacto del cliente #${lead.id} actualizados por ${req.user.email}`);
    res.json({
      lead: { id: lead.id, full_name: lead.full_name, dni: lead.dni, email: lead.email, phone: lead.phone }
    });
  } catch (error) {
    console.error('❌ Error al actualizar los datos del cliente:', error);
    res.status(400).json({ error: error.message || 'Error al actualizar los datos del cliente.' });
  }
});

app.get('/api/finance/income/:id/receipt', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const income = await financeLedgerService.getIncomeById(req.params.id);
    if (!assertVerifiedIncome(income, res)) return;

    const html = buildPaymentReceiptDocument({ income, forPrint: true });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('❌ Error al generar el comprobante de pago:', error);
    res.status(500).json({ error: 'Error al generar el comprobante de pago.', details: error.message });
  }
});

/**
 * El mismo comprobante en PDF: es EXACTAMENTE el archivo que se adjunta al
 * correo, así que la vista previa de "Enviar comprobante" muestra esto y no
 * una versión parecida.
 */
app.get('/api/finance/income/:id/receipt.pdf', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const income = await financeLedgerService.getIncomeById(req.params.id);
    if (!assertVerifiedIncome(income, res)) return;

    const pdf = await buildPaymentReceiptPdf({ income });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${receiptPdfFilename(income)}"`);
    res.send(pdf);
  } catch (error) {
    console.error('❌ Error al generar el PDF del comprobante:', error);
    res.status(500).json({ error: 'Error al generar el comprobante en PDF.', details: error.message });
  }
});

/** Manda ese mismo comprobante al correo del cliente. */
app.post('/api/finance/income/:id/receipt/send', requireAuth, requirePermission('finance.view'), uploadEmailAttachments, async (req, res) => {
  try {
    const { to, message } = req.body || {};
    const attachments = req.attachments || [];
    // Por defecto va el comprobante que arma el sistema, como siempre; se
    // desactiva cuando Finanzas manda la boleta o factura real adjunta.
    const includeDocument = req.body?.includeDocument !== 'false' && req.body?.includeDocument !== false;

    const income = await financeLedgerService.getIncomeById(req.params.id);
    // La verificación se exige solo para el comprobante generado: es el que
    // certifica el pago. Mandar la boleta que ya emitió Finanzas, o cualquier
    // otro archivo, no depende de ese visto bueno.
    if (includeDocument) {
      if (!assertVerifiedIncome(income, res)) return;
    } else if (!income) {
      return res.status(404).json({ error: 'Ingreso no encontrado.' });
    }

    if (!includeDocument && attachments.length === 0 && !(message || '').trim()) {
      return res.status(400).json({
        error: 'Sin el comprobante generado, adjunta al menos un archivo o escribe un mensaje.'
      });
    }

    const recipient = (to || '').trim() || income.lead_email;
    if (!recipient) {
      return res.status(400).json({ error: 'No hay un correo de destino (el lead no tiene correo registrado).' });
    }

    const result = await emailService.sendPaymentReceiptEmail(recipient, {
      income, message, includeDocument, attachments
    });
    if (!result.success) return res.status(502).json({ error: result.error || 'No se pudo enviar el correo.' });

    console.log(`🧾 [Finanzas] Comprobante del ingreso ${income.code} enviado a ${recipient}` +
      ` (documento generado: ${includeDocument ? 'sí' : 'no'}, ${attachments.length} adjunto(s))`);
    res.json({ result: { ...result, channel: 'email' } });
  } catch (error) {
    console.error('❌ Error al enviar el comprobante de pago:', error);
    res.status(502).json({ error: error.message || 'Error al enviar el comprobante de pago.' });
  }
});

app.get('/api/finance/receipts/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const receipt = await financeLedgerService.getReceiptById(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Comprobante no encontrado.' });
    sendFinanceFile(res, receipt.filename);
  } catch (error) {
    console.error('❌ Error al obtener el comprobante:', error);
    res.status(500).json({ error: 'Error al obtener el comprobante.', details: error.message });
  }
});

app.delete('/api/finance/receipts/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    await financeLedgerService.deleteReceipt(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el comprobante:', error);
    res.status(500).json({ error: 'Error al eliminar el comprobante.', details: error.message });
  }
});

// --- Libro diario ---
app.get('/api/finance/journal', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const journal = await financeLedgerService.listJournal();
    res.json({ journal });
  } catch (error) {
    console.error('❌ Error al obtener el libro diario:', error);
    res.status(500).json({ error: 'Error al obtener el libro diario.', details: error.message });
  }
});

app.post('/api/finance/journal', requireAuth, requirePermission('finance.view'), uploadFinanceReceipt, async (req, res) => {
  try {
    const { fecha, detalle, monto, moneda, banco, estado, area, asientoPorDestino } = req.body || {};
    const record = await financeLedgerService.createJournal({
      fecha, detalle, monto, moneda, banco, estado, area, asientoPorDestino,
      receipts: req.receipts, createdBy: req.user.id
    });
    res.status(201).json({ journal: record });
  } catch (error) {
    console.error('❌ Error al registrar el asiento del libro diario:', error);
    res.status(400).json({ error: error.message || 'Error al registrar el asiento.' });
  }
});

app.put('/api/finance/journal/:id', requireAuth, requirePermission('finance.view'), uploadFinanceReceipt, async (req, res) => {
  try {
    const { fecha, detalle, monto, moneda, banco, estado, area, asientoPorDestino } = req.body || {};
    const record = await financeLedgerService.updateJournal(req.params.id, {
      fecha, detalle, monto, moneda, banco, estado, area, asientoPorDestino,
      receipts: req.receipts
    });
    if (!record) return res.status(404).json({ error: 'Asiento no encontrado.' });
    res.json({ journal: record });
  } catch (error) {
    console.error('❌ Error al editar el asiento del libro diario:', error);
    res.status(400).json({ error: error.message || 'Error al editar el asiento.' });
  }
});

// Los comprobantes del libro diario son 1:N, igual que los de los ingresos.
app.post('/api/finance/journal/:id/receipts', requireAuth, requirePermission('finance.view'), uploadFinanceReceipt, async (req, res) => {
  try {
    const receipts = await financeLedgerService.addJournalReceipts(req.params.id, req.receipts);
    res.status(201).json({ receipts });
  } catch (error) {
    console.error('❌ Error al subir el comprobante del libro diario:', error);
    res.status(400).json({ error: error.message || 'Error al subir el comprobante.' });
  }
});

app.get('/api/finance/journal-receipts/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const receipt = await financeLedgerService.getJournalReceiptById(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Comprobante no encontrado.' });
    sendFinanceFile(res, receipt.filename);
  } catch (error) {
    console.error('❌ Error al obtener el comprobante del libro diario:', error);
    res.status(500).json({ error: 'Error al obtener el comprobante.', details: error.message });
  }
});

app.delete('/api/finance/journal-receipts/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    await financeLedgerService.deleteJournalReceipt(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el comprobante del libro diario:', error);
    res.status(500).json({ error: 'Error al eliminar el comprobante.', details: error.message });
  }
});

app.delete('/api/finance/journal/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    await financeLedgerService.deleteJournal(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el asiento del libro diario:', error);
    res.status(500).json({ error: 'Error al eliminar el asiento.', details: error.message });
  }
});

// --- Finanzas (resumen por mes y banco) ---
app.get('/api/finance/overview', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const overview = await financeLedgerService.getOverview({ monthsBack: req.query.months });
    res.json(overview);
  } catch (error) {
    console.error('❌ Error al obtener el resumen de finanzas:', error);
    res.status(500).json({ error: 'Error al obtener el resumen de finanzas.', details: error.message });
  }
});

// --- Gastos fijos ---
app.get('/api/finance/fixed-expenses', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const expenses = await financeLedgerService.listFixedExpenses();
    res.json({ expenses });
  } catch (error) {
    console.error('❌ Error al obtener los gastos fijos:', error);
    res.status(500).json({ error: 'Error al obtener los gastos fijos.', details: error.message });
  }
});

app.post('/api/finance/fixed-expenses', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const { fecha, concepto, metodoPago, detalle, banco } = req.body || {};
    const record = await financeLedgerService.createFixedExpense({
      fecha, concepto, metodoPago, detalle, banco, createdBy: req.user.id
    });
    res.status(201).json({ expense: record });
  } catch (error) {
    console.error('❌ Error al registrar el gasto fijo:', error);
    res.status(400).json({ error: error.message || 'Error al registrar el gasto fijo.' });
  }
});

/**
 * Panel de control de pago mensual de los gastos fijos: matriz gasto × mes con
 * el estado pagado/pendiente.
 */
app.get('/api/finance/fixed-expenses/panel', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const panel = await financeLedgerService.getFixedExpensesPanel({ monthsBack: req.query.months });
    res.json(panel);
  } catch (error) {
    console.error('❌ Error al obtener el panel de gastos fijos:', error);
    res.status(500).json({ error: 'Error al obtener el panel de gastos fijos.', details: error.message });
  }
});

app.put('/api/finance/fixed-expenses/:id/payments/:period', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const payment = await financeLedgerService.setFixedExpensePayment(req.params.id, req.params.period, {
      estado: req.body?.estado,
      updatedBy: req.user.id
    });
    res.json({ payment });
  } catch (error) {
    console.error('❌ Error al actualizar el pago del gasto fijo:', error);
    res.status(400).json({ error: error.message || 'Error al actualizar el pago del gasto fijo.' });
  }
});

app.put('/api/finance/fixed-expenses/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const { fecha, concepto, metodoPago, detalle, banco } = req.body || {};
    const record = await financeLedgerService.updateFixedExpense(req.params.id, { fecha, concepto, metodoPago, detalle, banco });
    if (!record) return res.status(404).json({ error: 'Gasto fijo no encontrado.' });
    res.json({ expense: record });
  } catch (error) {
    console.error('❌ Error al actualizar el gasto fijo:', error);
    res.status(400).json({ error: error.message || 'Error al actualizar el gasto fijo.' });
  }
});

app.delete('/api/finance/fixed-expenses/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    await financeLedgerService.deleteFixedExpense(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el gasto fijo:', error);
    res.status(500).json({ error: 'Error al eliminar el gasto fijo.', details: error.message });
  }
});

// --- Salarios ---
// Registro de pagos al personal. Deliberadamente NO toca `finance_journal` ni
// `finance_income`: queda como historial propio, con su fecha, su estado
// (pagado/pendiente) y el monto en negativo por ser una salida de dinero.
app.get('/api/finance/salaries', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const salaries = await financeSalaryService.listSalaries();
    res.json({ salaries });
  } catch (error) {
    console.error('❌ Error al obtener los salarios:', error);
    res.status(500).json({ error: 'Error al obtener los salarios.', details: error.message });
  }
});

app.post('/api/finance/salaries', requireAuth, requirePermission('finance.view'), uploadFinanceReceipt, async (req, res) => {
  try {
    const { persona, cargo, fecha, periodo, monto, moneda, estado, metodoPago, banco, detalle } = req.body || {};
    const salary = await financeSalaryService.createSalary({
      persona, cargo, fecha, periodo, monto, moneda, estado, metodoPago, banco, detalle,
      receipts: req.receipts, createdBy: req.user.id
    });
    res.status(201).json({ salary });
  } catch (error) {
    console.error('❌ Error al registrar el salario:', error);
    res.status(400).json({ error: error.message || 'Error al registrar el salario.' });
  }
});

app.put('/api/finance/salaries/:id', requireAuth, requirePermission('finance.view'), uploadFinanceReceipt, async (req, res) => {
  try {
    const { persona, cargo, fecha, periodo, monto, moneda, estado, metodoPago, banco, detalle } = req.body || {};
    const salary = await financeSalaryService.updateSalary(req.params.id, {
      persona, cargo, fecha, periodo, monto, moneda, estado, metodoPago, banco, detalle,
      receipts: req.receipts
    });
    if (!salary) return res.status(404).json({ error: 'Salario no encontrado.' });
    res.json({ salary });
  } catch (error) {
    console.error('❌ Error al actualizar el salario:', error);
    res.status(400).json({ error: error.message || 'Error al actualizar el salario.' });
  }
});

// Alterna pagado ↔ pendiente desde la tabla, sin abrir el formulario.
app.patch('/api/finance/salaries/:id/estado', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const salary = await financeSalaryService.setSalaryStatus(req.params.id, req.body?.estado);
    if (!salary) return res.status(404).json({ error: 'Salario no encontrado.' });
    res.json({ salary });
  } catch (error) {
    console.error('❌ Error al cambiar el estado del salario:', error);
    res.status(400).json({ error: error.message || 'Error al cambiar el estado del salario.' });
  }
});

// Los comprobantes de un salario son 1:N y viven en la misma carpeta que los
// del libro diario; solo respaldan el pago, no entran en la contabilidad.
app.post('/api/finance/salaries/:id/receipts', requireAuth, requirePermission('finance.view'), uploadFinanceReceipt, async (req, res) => {
  try {
    const receipts = await financeSalaryService.addReceipts(req.params.id, req.receipts);
    res.status(201).json({ receipts });
  } catch (error) {
    console.error('❌ Error al subir el comprobante del salario:', error);
    res.status(400).json({ error: error.message || 'Error al subir el comprobante.' });
  }
});

app.get('/api/finance/salary-receipts/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    const receipt = await financeSalaryService.getReceiptById(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Comprobante no encontrado.' });
    sendFinanceFile(res, receipt.filename);
  } catch (error) {
    console.error('❌ Error al obtener el comprobante del salario:', error);
    res.status(500).json({ error: 'Error al obtener el comprobante.', details: error.message });
  }
});

app.delete('/api/finance/salary-receipts/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    await financeSalaryService.deleteReceipt(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el comprobante del salario:', error);
    res.status(500).json({ error: 'Error al eliminar el comprobante.', details: error.message });
  }
});

app.delete('/api/finance/salaries/:id', requireAuth, requirePermission('finance.view'), async (req, res) => {
  try {
    await financeSalaryService.deleteSalary(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el salario:', error);
    res.status(500).json({ error: 'Error al eliminar el salario.', details: error.message });
  }
});

/**
 * Evalúa el tema de tesis con Ollama Embeddings + LLM y lo envía por Correo Electrónico
 */
app.post('/api/evaluate', async (req, res) => {
  try {
    const {
      topic,
      academicLevel = 'Pregrado',
      fieldOfStudy = 'Ingeniería y Tecnología',
      email,
      phone,
      additionalNotes = '',
      apiKeyOverride = null,
      hostOverride = null
    } = req.body;

    if (!topic || topic.trim().length === 0) {
      return res.status(400).json({ error: 'El tema de tesis es requerido.' });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Proporcione una dirección de correo electrónico válida.' });
    }

    if (!phone || phone.trim().length < 6) {
      return res.status(400).json({ error: 'Proporcione un número de celular válido.' });
    }

    console.log(`\n🔍 Procesando nueva evaluación de tesis...`);
    console.log(`- Tema: "${topic}"`);
    console.log(`- Nivel: ${academicLevel} | Área: ${fieldOfStudy}`);
    console.log(`- Correo destinatario: ${email}`);
    console.log(`- Celular: ${phone}`);

    // Step 1: Evaluación con Ollama Cloud (Embedding + LLM)
    const reportData = await ollamaService.evaluateThesisViability({
      topic,
      academicLevel,
      fieldOfStudy,
      additionalNotes,
      apiKeyOverride,
      hostOverride
    });

    // Step 2: Envío por correo electrónico con Nodemailer
    const emailStatus = await emailService.sendReportEmail(email, reportData);

    // Guardar en historial
    const historyEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      topic,
      academicLevel,
      fieldOfStudy,
      email,
      phone,
      overallViabilityScore: reportData.evaluation.overallViabilityScore,
      viabilityLevel: reportData.evaluation.viabilityLevel,
      timestamp: reportData.timestamp,
      emailStatus: {
        success: emailStatus.success,
        mode: emailStatus.mode,
        previewUrl: emailStatus.previewUrl
      }
    };
    evaluationHistory.unshift(historyEntry);

    // Limitar historial a los últimos 20 ítems
    if (evaluationHistory.length > 20) evaluationHistory.pop();

    // Step 3: Registrar el lead en MySQL para el funnel de ventas
    // (no bloquea la respuesta al usuario si la base de datos no está disponible)
    let lead = null;
    try {
      lead = await leadService.createLead({
        topic,
        academicLevel,
        fieldOfStudy,
        email,
        phone,
        additionalNotes,
        overallViabilityScore: reportData.evaluation.overallViabilityScore,
        viabilityLevel: reportData.evaluation.viabilityLevel
      });
      console.log(`💾 [Leads] Lead #${lead.id} registrado en MySQL (${email})`);
    } catch (dbError) {
      console.warn('⚠️ [Leads] No se pudo registrar el lead en MySQL:', dbError.message);
    }

    res.json({
      success: true,
      report: reportData,
      emailStatus,
      lead
    });

  } catch (error) {
    console.error('❌ Error general en evaluación:', error);
    res.status(500).json({
      error: 'Error en el servidor al evaluar el tema de tesis.',
      details: error.message
    });
  }
});

/**
 * Obtener historial de evaluaciones
 */
app.get('/api/history', (req, res) => {
  res.json({
    total: evaluationHistory.length,
    history: evaluationHistory
  });
});

/**
 * Listado de leads registrados (vista de administración / funnel de ventas / base de datos)
 */
app.get('/api/leads', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const leads = await leadService.getAllLeads();
    res.json({ total: leads.length, leads });
  } catch (error) {
    console.error('❌ Error al obtener leads:', error);
    res.status(500).json({ error: 'Error al obtener los leads desde la base de datos.', details: error.message });
  }
});

/**
 * Registro manual de nuevo lead / prospecto desde el formulario de Base de Datos
 */
app.post('/api/leads', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const { fullName, full_name, phone } = req.body;
    const name = fullName || full_name;
    if (!name || !phone) {
      return res.status(400).json({ error: 'El nombre completo y el número de celular son requeridos.' });
    }

    const prospect = await leadService.createProspect(req.body);
    console.log(`👤 [Prospectos] Nuevo prospecto registrado #${prospect.id} (${name})`);
    res.status(201).json({ prospect, lead: prospect, message: 'Prospecto registrado exitosamente.' });
  } catch (error) {
    console.error('❌ Error al registrar prospecto:', error);
    res.status(500).json({ error: 'Error al registrar el prospecto.', details: error.message });
  }
});

/**
 * Backfill de un solo uso: completa grado académico/universidad/carrera de
 * los leads de un formulario de Meta Lead Ads importados ANTES de que
 * metaWebhookService.importLead() empezara a guardar esas respuestas (ver
 * backend/scripts/backfillMetaLeadgenFields.js). Se expone por HTTP en vez
 * de solo como script de CLI porque corre dentro de este mismo proceso, que
 * ya tiene DB_* y META_PAGE_ACCESS_TOKEN configurados correctamente — un
 * script lanzado por SSH en hosting compartido no hereda esas variables.
 */
app.post('/api/leads/backfill-meta-fields', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const result = await runMetaLeadgenBackfill();
    res.json(result);
  } catch (error) {
    console.error('❌ Error en el backfill de campos de Meta Lead Ads:', error);
    res.status(500).json({ error: 'Error al ejecutar el backfill.', details: error.message });
  }
});


/**
 * Detalle de un lead específico
 */
app.get('/api/leads/:id', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const lead = await leadService.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado.' });
    }
    res.json({ lead });
  } catch (error) {
    console.error('❌ Error al obtener el lead:', error);
    res.status(500).json({ error: 'Error al obtener el lead desde la base de datos.', details: error.message });
  }
});

/* ------------------- Notas / observaciones de un lead ------------------ */
/*
 * Bitácora interna del setter y del closer ("en qué se quedó este lead").
 * Vive aparte de `leads.additional_notes`, que lo escribe el propio prospecto
 * en el evaluador de tesis. La ruta de borrado cuelga de /api/lead-notes y no
 * de /api/leads/... para no competir con `/api/leads/:id`.
 */

app.get('/api/leads/:id/notes', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const notes = await leadNoteService.listForLead(req.params.id);
    res.json({ notes });
  } catch (error) {
    console.error('❌ Error al obtener las notas del lead:', error);
    res.status(500).json({ error: 'Error al obtener las notas del lead.', details: error.message });
  }
});

app.post('/api/leads/:id/notes', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const note = await leadNoteService.create(req.params.id, { body: req.body?.body, author: req.user });
    res.status(201).json({ note });
  } catch (error) {
    const badRequest = ['EMPTY_NOTE', 'NOTE_TOO_LONG'];
    if (badRequest.includes(error.code)) return res.status(400).json({ error: error.message });
    if (error.code === 'LEAD_NOT_FOUND') return res.status(404).json({ error: error.message });
    console.error('❌ Error al guardar la nota del lead:', error);
    res.status(500).json({ error: 'Error al guardar la nota.', details: error.message });
  }
});

/**
 * Historial de etapas de un lead: quién lo movió, desde dónde y hacia dónde,
 * incluidos los intentos que el backend rechazó (`blocked`).
 *
 * Existe por los reportes repetidos de "este lead se regresó solo al Funnel de
 * Setter": sin esta lista, la única forma de investigarlos era deducir qué
 * pudo haberlo movido. Ahora se lee desde la ficha del lead.
 */
app.get('/api/leads/:id/stage-history', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const history = await leadStageChangeService.listForLead(req.params.id);
    res.json({ history });
  } catch (error) {
    console.error('❌ Error al obtener el historial de etapas del lead:', error);
    res.status(500).json({ error: 'Error al obtener el historial de etapas.', details: error.message });
  }
});

app.delete('/api/lead-notes/:noteId', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    await leadNoteService.remove(req.params.noteId, {
      userId: req.user.id,
      canManage: req.user.permissions?.includes('roles.manage')
    });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'NOTE_NOT_FOUND') return res.status(404).json({ error: error.message });
    if (error.code === 'FORBIDDEN') return res.status(403).json({ error: error.message });
    console.error('❌ Error al borrar la nota del lead:', error);
    res.status(500).json({ error: 'Error al borrar la nota.', details: error.message });
  }
});

/**
 * Actualizar el estado de seguimiento comercial de un lead (columna del Kanban).
 * Al llegar al estado final del funnel ("ganado") se crea automáticamente el
 * proyecto asociado, con estado "Creado".
 */
app.patch('/api/leads/:id/status', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ error: 'El estado (status) es requerido.' });
    }

    const lead = await leadService.updateLeadStatus(req.params.id, status, {
      actor: req.user,
      reason: 'Cambio de etapa desde el panel.'
    });
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado.' });
    }

    let project = null;
    if (status === FUNNEL_FINAL_STATUS) {
      project = await projectService.createProjectFromLead(lead);
      console.log(`🚀 [Proyectos] Proyecto #${project.id} creado a partir del lead #${lead.id} (estado: Creado)`);
    }

    res.json({ lead, project });
  } catch (error) {
    console.error('❌ Error al actualizar el lead:', error);
    res.status(500).json({ error: 'Error al actualizar el lead.', details: error.message });
  }
});

/**
 * Cierre de venta desde el funnel: el vendedor arrastra el lead a "Ganado" y
 * registra en el mismo paso el precio total del cierre y el monto del primer
 * pago (pueden ser distintos si el cliente paga en cuotas). Varias cosas
 * ocurren juntas porque son una sola decisión comercial:
 *
 *   1. el lead pasa a la etapa ganadora,
 *   2. se fija `leads.total_amount`, el precio total contra el que Finanzas
 *      valida la suma de todas las cuotas que se registren después,
 *   3. se crea su proyecto, bloqueado hasta que el pago se verifique,
 *   4. nace el ingreso en Finanzas — "pagado" si ya adjuntó el voucher,
 *      "pendiente" si lo subirá después.
 *
 * Banco y tipo de comprobante tienen valor por defecto y Finanzas los puede
 * corregir después desde la tabla de ingresos.
 */
/**
 * Las cuotas del cronograma llegan como JSON dentro de un `multipart/form-data`
 * (el mismo POST sube los vouchers), así que hay que parsearlas a mano.
 * Un cronograma mal formado no puede tumbar el cierre de la venta: se ignora
 * y el lead se gana igual con su primer pago.
 */
function parseInstallments(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

app.post('/api/leads/:id/win', requireAuth, requirePermission('leads.view'), uploadFinanceReceipt, async (req, res) => {
  const vouchers = req.receipts || [];
  try {
    const { monto, banco, emitir, totalAmount } = req.body || {};
    const lead = await leadService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado.' });

    const existing = await financeLedgerService.findInitialPaymentByLead(lead.id);
    if (existing) {
      return res.status(409).json({
        error: `Este lead ya tiene registrado su primer pago (${existing.code}).`,
        income: existing
      });
    }

    // El precio total se fija antes de crear el ingreso, para que la validación
    // de "la suma de cuotas no supera el total" también corra sobre este primer pago.
    if (totalAmount !== undefined && totalAmount !== null && totalAmount !== '') {
      await financeLedgerService.setLeadTotalAmount(lead.id, totalAmount);
    }

    const updatedLead = await leadService.updateLeadStatus(lead.id, FUNNEL_FINAL_STATUS, {
      actor: req.user,
      reason: 'Cierre de venta registrado desde el funnel.'
    });
    const created = await projectService.createProjectFromLead(updatedLead);

    const today = new Date().toISOString().slice(0, 10);
    const income = await financeLedgerService.createIncome({
      fecha: today,
      dueDate: today,
      leadId: lead.id,
      cuota: '1era',
      emitir: emitir || 'boleta',
      monto,
      banco: banco || 'BCP',
      estado: 'pendiente',
      isInitialPayment: true,
      createdBy: req.user.id
    });

    // El voucher es opcional; si viene, el ingreso queda cobrado de una vez.
    let withVoucher = income;
    if (vouchers.length > 0) {
      await financeLedgerService.addIncomeReceipts(income.id, vouchers);
      withVoucher = await financeLedgerService.getIncomeById(income.id);
    }

    // Las cuotas que faltan por cobrar quedan pactadas desde el minuto cero,
    // cada una con su vencimiento: es el cronograma que después se imprime en
    // el contrato y que el cliente ve en su portal. El primer pago ya creado
    // entra en la lista para que no se le renumere ni se le duplique.
    let schedule = [withVoucher];
    const installments = parseInstallments(req.body?.installments);
    if (installments.length > 0) {
      schedule = await financeLedgerService.replaceScheduleForLead(
        lead.id,
        [{ id: withVoucher.id, monto: withVoucher.monto, dueDate: today, emitir: withVoucher.emitir, banco: withVoucher.banco }, ...installments],
        { createdBy: req.user.id }
      );
    }

    // Se relee el proyecto ya con su pago inicial: el bloqueo se deriva del
    // ingreso, que no existía cuando se creó el proyecto unas líneas antes.
    const project = await projectService.getProjectById(created.id);

    console.log(`🏆 [Ventas] Lead #${lead.id} ganado · proyecto #${project.id} · ingreso ${withVoucher.code} (${withVoucher.estado})` +
      ` · cronograma de ${schedule.length} cuota(s)`);
    res.status(201).json({ lead: updatedLead, project, income: withVoucher, schedule });
  } catch (error) {
    vouchers.forEach((f) => financeLedgerService.discardUploadedFile(f));
    console.error('❌ Error al registrar el cierre de venta:', error);
    res.status(400).json({ error: error.message || 'Error al registrar el cierre de venta.' });
  }
});

/**
 * Actualizar datos completos de un lead / prospecto (desde el modal de Base de Datos)
 */
app.put('/api/leads/:id', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const updated = await leadService.updateLead(req.params.id, req.body, { actor: req.user });
    if (!updated) {
      return res.status(404).json({ error: 'Lead no encontrado.' });
    }
    console.log(`✏️ [Prospectos] Prospecto actualizado #${req.params.id}`);
    res.json({ lead: updated, message: 'Prospecto actualizado exitosamente.' });
  } catch (error) {
    console.error('❌ Error al actualizar prospecto:', error);
    res.status(500).json({ error: 'Error al actualizar el prospecto.', details: error.message });
  }
});

/**
 * Eliminar un lead / prospecto
 */
app.delete('/api/leads/:id', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const deleted = await leadService.deleteLead(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Lead no encontrado.' });
    }
    console.log(`🗑️ [Prospectos] Prospecto eliminado #${req.params.id}`);
    res.json({ success: true, message: 'Prospecto eliminado exitosamente.' });
  } catch (error) {
    console.error('❌ Error al eliminar prospecto:', error);
    res.status(500).json({ error: 'Error al eliminar el prospecto.', details: error.message });
  }
});


/**
 * Verificación del webhook de Meta (Facebook) Lead Ads. Meta llama a este
 * endpoint por GET al configurar la suscripción, enviando hub.mode,
 * hub.verify_token y hub.challenge; hay que responder con el challenge tal cual
 * si el token coincide con META_VERIFY_TOKEN.
 */
app.get('/api/webhooks/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (metaWebhookService.verifyChallenge(mode, token)) {
    console.log('✅ [Meta Webhook] Verificación de suscripción exitosa.');
    return res.status(200).send(challenge);
  }

  console.warn('⚠️ [Meta Webhook] Verificación de suscripción fallida (token o modo inválido).');
  res.sendStatus(403);
});

/**
 * Recepción de eventos del webhook de Meta (Facebook) Lead Ads. Se responde
 * 200 de inmediato (Meta espera una respuesta rápida) y los leads se importan
 * en segundo plano vía la Graph API.
 */
app.post('/api/webhooks/meta', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const hasSecret = !!process.env.META_APP_SECRET;
  const signatureValid = hasSecret ? metaWebhookService.verifySignature(req.rawBody, signature) : null;

  const fields = (req.body?.entry || []).flatMap((e) => (e.changes || []).map((c) => c.field));
  console.log(`📩 [Meta Webhook] POST recibido. object=${req.body?.object} campos=[${fields.join(', ')}] firma=${hasSecret ? (signatureValid ? 'válida' : 'inválida') : 'sin verificar'}`);

  metaWebhookService.recordEvent({ body: req.body, signatureValid, hasSecret });

  if (hasSecret && !signatureValid) {
    console.warn('⚠️ [Meta Webhook] Firma de la solicitud inválida, se rechaza el evento.');
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  const body = req.body || {};
  if (body.object !== 'page') return;

  Promise.all((body.entry || []).map((entry) => metaWebhookService.handleEntry(entry))).catch((error) => {
    console.error('❌ [Meta Webhook] Error al procesar el evento del webhook:', error);
  });
});

/**
 * Últimos eventos crudos recibidos en el webhook de Meta (de cualquier campo),
 * para verificar en la UI que la suscripción está realmente conectada mientras
 * la app sigue en modo desarrollo.
 */
app.get('/api/webhooks/meta/events', requireAuth, requirePermission('leads.view'), (req, res) => {
  res.json({ events: metaWebhookService.getRecentEvents() });
});

/**
 * Limpia el historial de eventos de prueba mostrado en la UI.
 */
app.delete('/api/webhooks/meta/events', requireAuth, requirePermission('leads.view'), (req, res) => {
  metaWebhookService.clearRecentEvents();
  res.json({ success: true });
});

/**
 * Interacciones (comentarios, reacciones, publicaciones, compartidos) de las
 * páginas de Facebook conectadas, recibidas vía el campo "feed" del webhook.
 */
app.get('/api/social-interactions', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const itemType = req.query.itemType || null;
    const [interactions, stats] = await Promise.all([
      pageInteractionService.getRecent({ limit, itemType, platform: 'facebook' }),
      pageInteractionService.getStats({ platform: 'facebook' })
    ]);
    res.json({ interactions, stats });
  } catch (error) {
    console.error('❌ Error al obtener las interacciones de la página:', error);
    res.status(500).json({ error: 'Error al obtener las interacciones de la página.', details: error.message });
  }
});

/**
 * Miniatura de un post de Facebook/Instagram servida desde una copia local
 * (las URLs firmadas de Meta caducan). Responde 404 si no hay imagen — el
 * frontend muestra un marcador en su lugar.
 */
app.get('/api/social-interactions/post-image/:postId', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const image = await pageInteractionService.getCachedPostImage(req.params.postId);
    if (!image) return res.status(404).end();
    res.type(image.mimeType);
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(image.filePath);
  } catch (error) {
    console.error('❌ Error al servir la miniatura del post:', error);
    res.status(404).end();
  }
});

/**
 * Mensajes directos (Messenger) recibidos en la bandeja de entrada de la Página.
 */
app.get('/api/page-messages', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [messages, stats] = await Promise.all([
      pageMessageService.getRecent({ limit }),
      pageMessageService.getStats()
    ]);
    res.json({ messages, stats });
  } catch (error) {
    console.error('❌ Error al obtener los mensajes de Messenger:', error);
    res.status(500).json({ error: 'Error al obtener los mensajes de Messenger.', details: error.message });
  }
});

/**
 * Conteo de seguidores de la página: último valor sondeado + historial, para
 * ver la tendencia (no es un contador en tiempo real, ver pageFollowerService).
 */
app.get('/api/social-followers', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const [latest, history] = await Promise.all([
      pageFollowerService.getLatest(),
      pageFollowerService.getHistory({ limit: 100 })
    ]);
    res.json({ latest, history });
  } catch (error) {
    console.error('❌ Error al obtener el historial de seguidores:', error);
    res.status(500).json({ error: 'Error al obtener el historial de seguidores.', details: error.message });
  }
});

/**
 * Fuerza un sondeo inmediato del conteo de seguidores (en vez de esperar al
 * siguiente ciclo automático).
 */
app.post('/api/social-followers/poll', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const snapshot = await pageFollowerService.pollAndStore();
    res.json({ snapshot });
  } catch (error) {
    console.error('❌ Error al sondear el conteo de seguidores:', error);
    res.status(502).json({ error: 'No se pudo sondear el conteo de seguidores.', details: error.message });
  }
});

/**
 * Perfil y métricas de la cuenta de Instagram Business conectada
 */
app.get('/api/instagram/profile', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const profile = await instagramService.getProfile();
    res.json({ profile });
  } catch (error) {
    console.error('❌ Error al obtener perfil de Instagram:', error);
    res.status(500).json({ error: 'Error al obtener perfil de Instagram.', details: error.message });
  }
});

/**
 * Publicaciones y Reels de la cuenta de Instagram
 */
app.get('/api/instagram/media', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 12, 50);
    const media = await instagramService.getMedia(limit);
    res.json({ media });
  } catch (error) {
    console.error('❌ Error al obtener publicaciones de Instagram:', error);
    res.status(500).json({ error: 'Error al obtener publicaciones de Instagram.', details: error.message });
  }
});

/**
 * Interacciones de Instagram: comentarios, menciones, DMs, respuestas a historias
 */
app.get('/api/instagram/interactions', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const itemType = req.query.itemType || null;
    const [interactions, stats] = await Promise.all([
      instagramService.getInteractions({ limit, itemType }),
      instagramService.getStats()
    ]);
    res.json({ interactions, stats });
  } catch (error) {
    console.error('❌ Error al obtener interacciones de Instagram:', error);
    res.status(500).json({ error: 'Error al obtener interacciones de Instagram.', details: error.message });
  }
});

/**
 * Estadísticas resumidas de Instagram
 */
app.get('/api/instagram/stats', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const stats = await instagramService.getStats();
    res.json({ stats });
  } catch (error) {
    console.error('❌ Error al obtener estadísticas de Instagram:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas de Instagram.', details: error.message });
  }
});

/**
 * Estado (sin exponer valores secretos) de las credenciales necesarias para
 * que el panel de Instagram muestre datos reales de la Graph API.
 */
app.get('/api/instagram/config-status', requireAuth, requirePermission('leads.view'), (req, res) => {
  res.json({
    hasPageAccessToken: !!process.env.META_PAGE_ACCESS_TOKEN,
    hasInstagramAccountId: !!process.env.META_INSTAGRAM_ACCOUNT_ID,
    hasAppSecret: instagramWebhookService.hasAppSecret(),
    hasVerifyToken: !!(process.env.META_INSTAGRAM_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN)
  });
});

/**
 * Verificación del webhook de Instagram (Graph API / Instagram Messaging / Comments).
 * Meta llama a este endpoint por GET al configurar la suscripción del webhook.
 */
app.get('/api/webhooks/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (instagramWebhookService.verifyChallenge(mode, token)) {
    console.log('✅ [Instagram Webhook] Verificación de suscripción exitosa.');
    return res.status(200).send(challenge);
  }

  console.warn('⚠️ [Instagram Webhook] Verificación de suscripción fallida (token o modo inválido).');
  res.sendStatus(403);
});

/**
 * Recepción de eventos del webhook de Instagram. Responde 200 inmediatamente
 * y procesa las entradas en segundo plano.
 */
app.post('/api/webhooks/instagram', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const hasSecret = instagramWebhookService.hasAppSecret();
  const signatureValid = hasSecret ? instagramWebhookService.verifySignature(req.rawBody, signature) : null;

  const fields = (req.body?.entry || []).flatMap((e) => (e.changes || []).map((c) => c.field));
  console.log(`📸 [Instagram Webhook] POST recibido. object=${req.body?.object} campos=[${fields.join(', ')}] firma=${hasSecret ? (signatureValid ? 'válida' : 'inválida') : 'sin verificar'}`);

  instagramWebhookService.recordEvent({ body: req.body, signatureValid, hasSecret });

  if (hasSecret && !signatureValid) {
    console.warn('⚠️ [Instagram Webhook] Firma de la solicitud inválida, se rechaza el evento.');
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  const body = req.body || {};
  if (body.object !== 'instagram' && body.object !== 'page') return;

  Promise.all((body.entry || []).map((entry) => instagramWebhookService.handleEntry(entry))).catch((error) => {
    console.error('❌ [Instagram Webhook] Error al procesar el evento de Instagram:', error);
  });
});

/**
 * Últimos eventos crudos recibidos en el webhook de Instagram (JSON).
 */
app.get('/api/webhooks/instagram/events', requireAuth, requirePermission('leads.view'), (req, res) => {
  res.json({ events: instagramWebhookService.getRecentEvents() });
});

/**
 * Limpia el historial de eventos de prueba de Instagram en la UI.
 */
app.delete('/api/webhooks/instagram/events', requireAuth, requirePermission('leads.view'), (req, res) => {
  instagramWebhookService.clearRecentEvents();
  res.json({ success: true });
});

/**

 * Verificación del webhook de WhatsApp Business Platform (mismo mecanismo que
 * el de Page/Lead Ads, pero con su propio verify token y URL de callback,
 * configurados por separado en el producto "WhatsApp" de la app de Meta).
 */
app.get('/api/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (whatsappWebhookService.verifyChallenge(mode, token)) {
    console.log('✅ [WhatsApp Webhook] Verificación de suscripción exitosa.');
    return res.status(200).send(challenge);
  }

  console.warn('⚠️ [WhatsApp Webhook] Verificación de suscripción fallida (token o modo inválido).');
  res.sendStatus(403);
});

/**
 * Recepción de eventos del webhook de WhatsApp: mensajes entrantes y
 * actualizaciones de estado de mensajes enviados.
 */
app.post('/api/webhooks/whatsapp', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const hasSecret = !!process.env.META_APP_SECRET;
  const signatureValid = hasSecret ? whatsappWebhookService.verifySignature(req.rawBody, signature) : null;

  const fields = (req.body?.entry || []).flatMap((e) => (e.changes || []).map((c) => c.field));
  console.log(`📩 [WhatsApp Webhook] POST recibido. object=${req.body?.object} campos=[${fields.join(', ')}] firma=${hasSecret ? (signatureValid ? 'válida' : 'inválida') : 'sin verificar'}`);

  whatsappWebhookService.recordEvent({ body: req.body, signatureValid, hasSecret });

  if (hasSecret && !signatureValid) {
    console.warn('⚠️ [WhatsApp Webhook] Firma de la solicitud inválida, se rechaza el evento.');
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  const body = req.body || {};
  if (body.object !== 'whatsapp_business_account') return;

  Promise.all((body.entry || []).map((entry) => whatsappWebhookService.handleEntry(entry))).catch((error) => {
    console.error('❌ [WhatsApp Webhook] Error al procesar el evento del webhook:', error);
  });
});

/**
 * Últimos eventos crudos recibidos en el webhook de WhatsApp, para verificar
 * en la UI que la suscripción está realmente conectada.
 */
app.get('/api/webhooks/whatsapp/events', requireAuth, requirePermission('leads.view'), (req, res) => {
  res.json({ events: whatsappWebhookService.getRecentEvents() });
});

/**
 * Limpia el historial de eventos de prueba del webhook de WhatsApp.
 */
app.delete('/api/webhooks/whatsapp/events', requireAuth, requirePermission('leads.view'), (req, res) => {
  whatsappWebhookService.clearRecentEvents();
  res.json({ success: true });
});

/**
 * Recepción de eventos del webhook de YCloud (proveedor alternativo de
 * WhatsApp Business Platform en modo coexistencia — ver WHATSAPP_PROVIDER en
 * whatsappMessageService.js). A diferencia del de Meta, no hay verificación
 * GET por "hub.challenge": YCloud firma cada POST con "YCloud-Signature" y el
 * secret configurado al crear el endpoint (dashboard.ycloud.com > Developer >
 * Webhooks > Add Endpoint, con URL .../api/webhooks/ycloud y los eventos
 * whatsapp.inbound_message.received y whatsapp.message.updated).
 */
app.post('/api/webhooks/ycloud', (req, res) => {
  const signature = req.headers['ycloud-signature'];
  const hasSecret = !!process.env.YCLOUD_WEBHOOK_SECRET;
  const signatureValid = hasSecret ? ycloudWebhookService.verifySignature(req.rawBody, signature) : null;

  console.log(`📩 [YCloud Webhook] POST recibido. type=${req.body?.type} firma=${hasSecret ? (signatureValid ? 'válida' : 'inválida') : 'sin verificar'}`);

  ycloudWebhookService.recordEvent({ body: req.body, signatureValid, hasSecret });

  if (hasSecret && !signatureValid) {
    console.warn('⚠️ [YCloud Webhook] Firma de la solicitud inválida, se rechaza el evento.');
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  ycloudWebhookService.handleEvent(req.body || {}).catch((error) => {
    console.error('❌ [YCloud Webhook] Error al procesar el evento del webhook:', error);
  });
});

/**
 * Últimos eventos crudos recibidos en el webhook de YCloud, para verificar en
 * la UI que la suscripción está realmente conectada.
 */
app.get('/api/webhooks/ycloud/events', requireAuth, requirePermission('leads.view'), (req, res) => {
  res.json({ events: ycloudWebhookService.getRecentEvents() });
});

/**
 * Limpia el historial de eventos de prueba del webhook de YCloud.
 */
app.delete('/api/webhooks/ycloud/events', requireAuth, requirePermission('leads.view'), (req, res) => {
  ycloudWebhookService.clearRecentEvents();
  res.json({ success: true });
});

/**
 * Listado de mensajes de WhatsApp recibidos y persistidos en la base de datos.
 */
app.get('/api/whatsapp/messages', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [messages, stats] = await Promise.all([
      whatsappMessageService.getRecent({ limit }),
      whatsappMessageService.getStats()
    ]);
    res.json({ messages, stats });
  } catch (error) {
    console.error('❌ Error al obtener los mensajes de WhatsApp:', error);
    res.status(500).json({ error: 'Error al obtener los mensajes de WhatsApp.', details: error.message });
  }
});

/**
 * Bandeja de conversaciones de WhatsApp: un registro por contacto con su
 * último mensaje.
 */
app.get('/api/whatsapp/conversations', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const conversations = await whatsappMessageService.getConversations({ limit: 100 });
    res.json({ conversations });
  } catch (error) {
    console.error('❌ Error al obtener las conversaciones de WhatsApp:', error);
    res.status(500).json({ error: 'Error al obtener las conversaciones de WhatsApp.', details: error.message });
  }
});

/**
 * Exporta todas las conversaciones de WhatsApp de un día (hoy por defecto, o
 * ?date=YYYY-MM-DD) como un archivo de texto plano descargable.
 */
app.get('/api/whatsapp/conversations/export', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const raw = (req.query.date || '').trim();
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ error: 'El parámetro "date" debe tener el formato YYYY-MM-DD.' });
    }

    const { filename, content } = raw
      ? await whatsappMessageService.buildDayTranscript(raw)
      : await whatsappMessageService.buildDayTranscript();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (error) {
    console.error('❌ Error al exportar las conversaciones de WhatsApp:', error);
    res.status(500).json({ error: 'Error al exportar las conversaciones de WhatsApp.', details: error.message });
  }
});

/**
 * Elimina por completo una conversación de WhatsApp (todos sus mensajes y su
 * sesión del bot). Queda registrado en `whatsapp_conversation_deletions` qué
 * usuario la eliminó, ya que los mensajes en sí no dejan rastro.
 */
app.delete('/api/whatsapp/conversations/:waId', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const log = await whatsappMessageService.deleteConversation(req.params.waId, {
      deletedByUserId: req.user.id,
      deletedByName: req.user.name
    });
    if (!log) {
      return res.status(404).json({ error: 'No se encontró esa conversación.' });
    }
    console.log(`🗑️ [WhatsApp] Conversación con ${req.params.waId} eliminada por ${req.user.name} (#${req.user.id})`);
    res.json({ success: true, deletion: log });
  } catch (error) {
    console.error('❌ Error al eliminar la conversación de WhatsApp:', error);
    res.status(500).json({ error: 'Error al eliminar la conversación de WhatsApp.', details: error.message });
  }
});

/**
 * Registro de auditoría de conversaciones de WhatsApp eliminadas: qué
 * contacto, cuántos mensajes y qué usuario la eliminó.
 */
app.get('/api/whatsapp/conversations/deletions', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const deletions = await whatsappMessageService.getRecentDeletions({ limit: 50 });
    res.json({ deletions });
  } catch (error) {
    console.error('❌ Error al obtener el registro de conversaciones eliminadas:', error);
    res.status(500).json({ error: 'Error al obtener el registro de conversaciones eliminadas.', details: error.message });
  }
});

/**
 * Hilo completo (entrantes + salientes) de un contacto de WhatsApp.
 */
app.get('/api/whatsapp/conversations/:waId/messages', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const thread = await whatsappMessageService.getThread(req.params.waId, { limit: 200 });
    res.json({ messages: thread });
  } catch (error) {
    console.error('❌ Error al obtener el hilo de WhatsApp:', error);
    res.status(500).json({ error: 'Error al obtener el hilo de WhatsApp.', details: error.message });
  }
});

/**
 * Responde a un contacto de WhatsApp (mensaje de texto libre). Solo funciona
 * dentro de la ventana de 24h desde su último mensaje; fuera de ella, WhatsApp
 * exige una plantilla aprobada.
 */
app.post('/api/whatsapp/conversations/:waId/messages', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const body = (req.body?.body || '').trim();
    if (!body) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
    }
    const message = await whatsappMessageService.sendTextMessage(req.params.waId, body);

    // Si un asesor responde manualmente, se pausa Avan para esa
    // conversación (evita que el bot automático interrumpa a un humano
    // que ya está atendiendo al contacto) y se borra la marca de "urgente"
    // si la tenía: alguien del equipo ya la está atendiendo.
    await whatsappBotService.setBotEnabled(req.params.waId, false);
    await whatsappMessageService.clearHandoffMark(req.params.waId);

    res.status(201).json({ message });
  } catch (error) {
    console.error('❌ Error al enviar el mensaje de WhatsApp:', error);
    res.status(502).json({ error: 'No se pudo enviar el mensaje de WhatsApp.', details: error.message });
  }
});

/**
 * Sirve la copia local del adjunto (imagen/video/audio/documento) de un
 * mensaje de WhatsApp — el link que dan Meta/YCloud en el webhook caduca, así
 * que el panel siempre pide esta copia cacheada en vez de esa URL original.
 */
app.get('/api/whatsapp/messages/:id/media', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const message = await whatsappMessageService.getById(req.params.id);
    if (!message || !message.media_filename) return res.status(404).end();
    res.type(message.media_mime_type || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.join(whatsappMediaDir, message.media_filename));
  } catch (error) {
    console.error('❌ Error al servir el adjunto de WhatsApp:', error);
    res.status(404).end();
  }
});

/**
 * Estado del flujo automático de Avan para una conversación (paso actual,
 * si terminó, si está activo).
 */
app.get('/api/whatsapp/conversations/:waId/bot', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const session = await whatsappBotService.getSession(req.params.waId);
    res.json({ session: session || null });
  } catch (error) {
    console.error('❌ Error al obtener el estado del bot de WhatsApp:', error);
    res.status(500).json({ error: 'Error al obtener el estado del bot.', details: error.message });
  }
});

/**
 * Activa o pausa manualmente el bot Avan para una conversación.
 */
app.patch('/api/whatsapp/conversations/:waId/bot', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    await whatsappBotService.setBotEnabled(req.params.waId, enabled);
    const session = await whatsappBotService.getSession(req.params.waId);
    res.json({ session });
  } catch (error) {
    console.error('❌ Error al actualizar el estado del bot de WhatsApp:', error);
    res.status(500).json({ error: 'Error al actualizar el estado del bot.', details: error.message });
  }
});

/**
 * Reinicia la sesión del bot para un contacto (como si fuera nuevo), sin
 * borrar el historial de mensajes. Útil cuando una conversación de prueba ya
 * quedó "completed" o pausada y no vuelve a responder automáticamente.
 */
app.post('/api/whatsapp/conversations/:waId/bot/reset', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    await whatsappBotService.resetSession(req.params.waId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al reiniciar la sesión del bot de WhatsApp:', error);
    res.status(500).json({ error: 'Error al reiniciar la sesión del bot.', details: error.message });
  }
});

/**
 * Override manual: agenda el horario que el contacto ya eligió sin esperar
 * más el correo de invitación — para conversaciones atascadas en ese paso
 * (ver whatsappBotService.forceBookPendingSlot).
 */
app.post('/api/whatsapp/conversations/:waId/bot/force-book', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    await whatsappBotService.forceBookPendingSlot(req.params.waId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al forzar el agendamiento manual:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Configuración del motor conversacional de Avan por WhatsApp: instrucciones
 * de tono/objetivo para el LLM y los valores por defecto que se usan cuando
 * el lead no menciona su nivel, carrera o ámbito.
 */
app.get('/api/whatsapp/bot-settings', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const settings = await whatsappBotSettingsService.get();
    res.json({ settings, promptDefaults: whatsappBotSettingsService.getPromptDefaults() });
  } catch (error) {
    console.error('❌ Error al obtener la configuración del bot:', error);
    res.status(500).json({ error: 'Error al obtener la configuración del bot.', details: error.message });
  }
});

app.put('/api/whatsapp/bot-settings', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const {
      toneInstructions, botIdentity, botObjective, promptRules,
      faqKnowledge, meetingDurationMinutes,
      defaultAcademicLevel, defaultFieldOfStudy, defaultLocation,
      shortRepliesEnabled, typingIndicatorEnabled, messageGapSeconds,
      salesNotificationPhone, salesNotificationEmail,
      pricePregradoMin, pricePregradoMax, priceMaestriaMin, priceMaestriaMax,
      priceDoctoradoMin, priceDoctoradoMax
    } = req.body || {};
    const settings = await whatsappBotSettingsService.update({
      toneInstructions, botIdentity, botObjective, promptRules,
      faqKnowledge, meetingDurationMinutes,
      defaultAcademicLevel, defaultFieldOfStudy, defaultLocation,
      shortRepliesEnabled, typingIndicatorEnabled, messageGapSeconds,
      salesNotificationPhone, salesNotificationEmail,
      pricePregradoMin, pricePregradoMax, priceMaestriaMin, priceMaestriaMax,
      priceDoctoradoMin, priceDoctoradoMax
    });
    res.json({ settings });
  } catch (error) {
    console.error('❌ Error al guardar la configuración del bot:', error);
    res.status(500).json({ error: 'Error al guardar la configuración del bot.', details: error.message });
  }
});

/**
 * Manda AHORA la agenda del día al vendedor, sin esperar a las 8 de la mañana
 * ni marcar el día como enviado. Sirve para probar el aviso —y para reenviarlo
 * si el vendedor lo perdió— desde el panel del bot.
 */
app.post('/api/whatsapp/bot/daily-agenda', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const result = await whatsappBotService.sendDailyAgendaToSalesperson({ force: true });
    res.json({ result });
  } catch (error) {
    console.error('❌ Error al mandar la agenda diaria al vendedor:', error);
    res.status(500).json({ error: 'Error al mandar la agenda diaria.', details: error.message });
  }
});

/**
 * Bitácora en memoria de la actividad del bot de WhatsApp: cuándo agrupa
 * mensajes de un contacto nuevo, qué le manda al LLM de Ollama Cloud, qué
 * respondió, y si el envío por WhatsApp tuvo éxito. Permite verificar
 * visualmente desde el panel de WhatsApp que el flujo está funcionando.
 */
app.get('/api/whatsapp/bot-activity', requireAuth, requirePermission('leads.view'), (req, res) => {
  res.json({ activity: whatsappBotService.getActivity() });
});

app.delete('/api/whatsapp/bot-activity', requireAuth, requirePermission('leads.view'), (req, res) => {
  whatsappBotService.clearActivity();
  res.json({ success: true });
});

/**
 * Estado (sin exponer valores secretos) de las credenciales necesarias para
 * que el bot pueda enviar mensajes reales por WhatsApp y para que el LLM de
 * Ollama Cloud responda. Se usa para mostrar avisos claros en el panel si
 * falta alguna, en vez de que los mensajes fallen en silencio.
 */
app.get('/api/whatsapp/config-status', requireAuth, requirePermission('leads.view'), (req, res) => {
  res.json({
    whatsapp: {
      hasPhoneNumberId: !!process.env.META_WHATSAPP_PHONE_NUMBER_ID,
      hasAccessToken: !!(process.env.META_WHATSAPP_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN),
      hasAppSecret: !!process.env.META_APP_SECRET,
      hasVerifyToken: !!process.env.META_WHATSAPP_VERIFY_TOKEN
    },
    ollama: {
      hasApiKey: !!process.env.OLLAMA_API_KEY,
      host: process.env.OLLAMA_HOST || 'https://ollama.com',
      chatModel: process.env.OLLAMA_CHAT_MODEL || 'llama3:latest'
    }
  });
});

/**
 * Configuración pública (App ID + Configuration ID, ninguno secreto) que el
 * frontend necesita para inicializar el SDK de Facebook y abrir el pop-up de
 * Embedded Signup.
 */
app.get('/api/whatsapp/embedded-signup/config', requireAuth, requirePermission('leads.view'), (req, res) => {
  res.json(metaEmbeddedSignupService.getPublicConfig());
});

/**
 * Recibe el `code` que devuelve el pop-up de Embedded Signup (Facebook Login
 * for Business), lo cambia por un access_token, verifica a qué WABA da
 * acceso, resuelve el phone_number_id, suscribe la app a los webhooks de esa
 * WABA y guarda las credenciales. `wabaId`/`phoneNumberId`/`businessId` son
 * pistas opcionales que llegan del evento `postMessage` WA_EMBEDDED_SIGNUP
 * capturado en el frontend — el backend igual las valida contra lo que el
 * propio token de Meta autorizó antes de confiar en ellas.
 */
app.post('/api/whatsapp/embedded-callback', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const { code, wabaId, phoneNumberId, businessId, mode } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: 'El parámetro "code" es obligatorio.' });
    }
    const account = await metaEmbeddedSignupService.completeSignup({
      code,
      wabaIdHint: wabaId,
      phoneNumberIdHint: phoneNumberId,
      businessIdHint: businessId,
      mode: mode === 'full_migration' ? 'full_migration' : 'coexistence'
    });
    res.json({ success: true, account });
  } catch (error) {
    console.error('❌ Error al completar el Embedded Signup de WhatsApp:', error);
    res.status(500).json({ error: 'No se pudo completar el registro de WhatsApp.', details: error.message });
  }
});

/**
 * Cuentas de WhatsApp vinculadas por Embedded Signup (sin exponer el
 * access_token), para mostrarlas en el panel.
 */
app.get('/api/whatsapp/embedded-accounts', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const accounts = await metaEmbeddedSignupService.listAccounts();
    res.json({ accounts });
  } catch (error) {
    console.error('❌ Error al listar las cuentas de WhatsApp vinculadas:', error);
    res.status(500).json({ error: 'No se pudieron obtener las cuentas vinculadas.', details: error.message });
  }
});

/**
 * Simulador de prueba: procesa un mensaje como si viniera de WhatsApp, sin
 * pasar por el webhook real de Meta ni por la Graph API. Sirve para probar el
 * agrupado de mensajes y la conversación con el LLM de Ollama Cloud aunque
 * las credenciales de envío de WhatsApp todavía no estén configuradas; el
 * resultado se ve en /api/whatsapp/bot-activity. El mensaje simulado sí se
 * guarda en la tabla de mensajes (etiquetado como "Simulado"), porque el
 * motor conversacional necesita el hilo completo para tener contexto entre
 * turnos — usa un wa_id de prueba, no uno real.
 */
app.post('/api/whatsapp/bot-test/simulate', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const waId = (req.body?.waId || '').trim();
    const text = (req.body?.text || '').trim();
    if (!waId || !text) {
      return res.status(400).json({ error: 'waId y text son obligatorios.' });
    }
    await whatsappMessageService.createSimulatedInbound(waId, text);
    await whatsappBotService.handleIncomingMessage(waId, text);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al simular un mensaje de WhatsApp:', error);
    res.status(500).json({ error: 'Error al simular el mensaje.', details: error.message });
  }
});

/**
 * Listado de columnas (etapas) del Kanban de Leads, ordenadas por posición.
 */
app.get('/api/funnel-columns', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const columns = await funnelColumnService.getAllColumns();
    res.json({ columns });
  } catch (error) {
    console.error('❌ Error al obtener las columnas del funnel:', error);
    res.status(500).json({ error: 'Error al obtener las columnas del funnel.', details: error.message });
  }
});

/**
 * Crear una nueva columna (etapa) del funnel de ventas
 */
app.post('/api/funnel-columns', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const { key, label, icon, color, final: isFinal, quoted: isQuoted } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'El nombre de la columna es requerido.' });
    }
    const columnKey = (key && key.trim()) || 'col_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);

    const existing = await funnelColumnService.getColumnByKey(columnKey);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una columna con esa clave.' });
    }

    const column = await funnelColumnService.createColumn({ key: columnKey, label: label.trim(), icon, color, final: isFinal, quoted: isQuoted });
    res.status(201).json({ column });
  } catch (error) {
    console.error('❌ Error al crear la columna:', error);
    res.status(500).json({ error: 'Error al crear la columna del funnel.', details: error.message });
  }
});

/**
 * Reordenar columnas del funnel (recibe el arreglo completo de keys en el nuevo orden)
 */
app.patch('/api/funnel-columns/reorder', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const { keys } = req.body;
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'keys debe ser un arreglo con el orden de las columnas.' });
    }
    const columns = await funnelColumnService.reorderColumns(keys);
    res.json({ columns });
  } catch (error) {
    console.error('❌ Error al reordenar las columnas:', error);
    res.status(500).json({ error: 'Error al reordenar las columnas del funnel.', details: error.message });
  }
});

/**
 * Editar nombre, icono, color o marca de "etapa ganadora" de una columna
 */
app.put('/api/funnel-columns/:key', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const existing = await funnelColumnService.getColumnByKey(req.params.key);
    if (!existing) {
      return res.status(404).json({ error: 'Columna no encontrada.' });
    }
    const { label, icon, color, final: isFinal, quoted: isQuoted } = req.body;
    const column = await funnelColumnService.updateColumn(req.params.key, { label, icon, color, final: isFinal, quoted: isQuoted });
    res.json({ column });
  } catch (error) {
    console.error('❌ Error al actualizar la columna:', error);
    res.status(500).json({ error: 'Error al actualizar la columna del funnel.', details: error.message });
  }
});

/**
 * Eliminar una columna del funnel. Los leads que estén en ella deben
 * reasignarse desde el cliente antes de invocar este endpoint.
 */
app.delete('/api/funnel-columns/:key', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const existing = await funnelColumnService.getColumnByKey(req.params.key);
    if (!existing) {
      return res.status(404).json({ error: 'Columna no encontrada.' });
    }
    await funnelColumnService.deleteColumn(req.params.key);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar la columna:', error);
    res.status(500).json({ error: 'Error al eliminar la columna del funnel.', details: error.message });
  }
});

// =====================================================================
// CATÁLOGO DE CARRERAS (/api/careers)
// =====================================================================
// Las áreas y carreras que alimentan todos los desplegables de "Carrera".
// La lectura es pública porque el evaluador de tesis (/evaluador-tesis) no
// pide sesión y necesita la misma lista; escribir exige `careers.manage`.

/**
 * Catálogo para los desplegables: solo carreras activas, agrupadas y en orden.
 */
app.get('/api/careers', async (req, res) => {
  try {
    const groups = await careerCatalogService.listCatalog();
    res.json({ groups });
  } catch (error) {
    console.error('❌ Error al obtener el catálogo de carreras:', error);
    res.status(500).json({ error: 'Error al obtener el catálogo de carreras.', details: error.message });
  }
});

/**
 * Catálogo completo para la pantalla de administración: incluye las carreras
 * desactivadas y cuántos leads/proyectos usan cada una.
 */
app.get('/api/careers/manage', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const groups = await careerCatalogService.listCatalog({ includeInactive: true, withUsage: true });
    res.json({ groups });
  } catch (error) {
    console.error('❌ Error al obtener el catálogo de carreras:', error);
    res.status(500).json({ error: 'Error al obtener el catálogo de carreras.', details: error.message });
  }
});

app.post('/api/careers/groups', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const group = await careerCatalogService.createGroup(req.body?.label);
    res.status(201).json({ group });
  } catch (error) {
    console.error('❌ Error al crear el área de carreras:', error);
    res.status(400).json({ error: error.message || 'Error al crear el área.' });
  }
});

app.patch('/api/careers/groups/reorder', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids debe ser un arreglo con el orden de las áreas.' });
    }
    const groups = await careerCatalogService.reorderGroups(ids);
    res.json({ groups });
  } catch (error) {
    console.error('❌ Error al reordenar las áreas de carreras:', error);
    res.status(500).json({ error: 'Error al reordenar las áreas.', details: error.message });
  }
});

app.put('/api/careers/groups/:id', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const group = await careerCatalogService.renameGroup(req.params.id, req.body?.label);
    if (!group) return res.status(404).json({ error: 'Área no encontrada.' });
    res.json({ group });
  } catch (error) {
    console.error('❌ Error al renombrar el área de carreras:', error);
    res.status(400).json({ error: error.message || 'Error al renombrar el área.' });
  }
});

app.delete('/api/careers/groups/:id', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const group = await careerCatalogService.deleteGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Área no encontrada.' });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el área de carreras:', error);
    res.status(400).json({ error: error.message || 'Error al eliminar el área.' });
  }
});

app.post('/api/careers', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const { groupId, name } = req.body || {};
    const career = await careerCatalogService.createCareer({ groupId, name });
    res.status(201).json({ career });
  } catch (error) {
    console.error('❌ Error al crear la carrera:', error);
    res.status(400).json({ error: error.message || 'Error al crear la carrera.' });
  }
});

app.patch('/api/careers/reorder', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const { groupId, ids } = req.body || {};
    if (!groupId || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Se requiere groupId y un arreglo ids con el nuevo orden.' });
    }
    const groups = await careerCatalogService.reorderCareers(groupId, ids);
    res.json({ groups });
  } catch (error) {
    console.error('❌ Error al reordenar las carreras:', error);
    res.status(500).json({ error: 'Error al reordenar las carreras.', details: error.message });
  }
});

/**
 * Renombrar, mover de área o activar/desactivar una carrera. Con
 * `propagate: true` el nuevo nombre también se escribe en los leads y
 * proyectos que tenían el anterior (los documentos emitidos no se tocan).
 */
app.put('/api/careers/:id', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const { name, groupId, active, propagate } = req.body || {};
    const result = await careerCatalogService.updateCareer(req.params.id, { name, groupId, active, propagate });
    if (!result) return res.status(404).json({ error: 'Carrera no encontrada.' });
    res.json(result);
  } catch (error) {
    console.error('❌ Error al actualizar la carrera:', error);
    res.status(400).json({ error: error.message || 'Error al actualizar la carrera.' });
  }
});

app.delete('/api/careers/:id', requireAuth, requirePermission('careers.manage'), async (req, res) => {
  try {
    const career = await careerCatalogService.deleteCareer(req.params.id);
    if (!career) return res.status(404).json({ error: 'Carrera no encontrada.' });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar la carrera:', error);
    res.status(500).json({ error: 'Error al eliminar la carrera.', details: error.message });
  }
});

/**
 * Genera y envía por correo una cotización para un lead del funnel de ventas
 * (disponible en cualquier etapa, ya que las columnas del funnel son
 * configurables por el equipo).
 */
app.post('/api/leads/:id/quote', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const {
      amount,
      currency = 'PEN',
      notes,
      conceptTitle,
      quantity,
      scopeItems,
      code,
      estimatedTime,
      statusLabel,
      regularAmount,
      discount,
      serviceSubtitle,
      warrantyText,
      commercialTerms,
      validUntil
    } = req.body;
    const parsedAmount = Number(amount);
    const parsedQuantity = Number(quantity) > 0 ? Math.floor(Number(quantity)) : 1;

    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Proporcione un monto válido para la cotización.' });
    }

    const lead = await leadService.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado.' });
    }

    // Vigencia: la que ponga el vendedor; si no la indica, 10 días calendario
    // desde la emisión, como se venía haciendo.
    const vigencia = validUntil || new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const quote = await quoteService.createQuote({
      leadId: lead.id,
      amount: parsedAmount,
      currency,
      notes,
      conceptTitle,
      quantity: parsedQuantity,
      scopeItems,
      validUntil: vigencia,
      code,
      estimatedTime,
      statusLabel,
      regularAmount,
      discount,
      serviceSubtitle,
      warrantyText,
      commercialTerms
    });
    const emailStatus = await emailService.sendQuoteEmail(lead.email, { quote, lead });

    // Cotizar es, en la práctica, el cambio de etapa: el lead pasa a estar
    // "ya cotizado". Se mueve solo para no depender de que alguien se acuerde
    // de arrastrarlo, pero se devuelve `previousStatus` para que el panel
    // pueda ofrecer "Deshacer" — mover el lead equivocado no puede costar
    // rehacer nada a mano.
    //
    // Si el equipo todavía no marcó ninguna columna como etapa de cotización,
    // no se inventa un destino: se informa y el lead se queda donde está.
    let movedTo = null;
    let previousStatus = null;
    const quotedColumn = await funnelColumnService.getQuotedColumn();
    if (quotedColumn && lead.status !== quotedColumn.key) {
      previousStatus = lead.status;
      await leadService.updateLeadStatus(lead.id, quotedColumn.key, {
        actor: req.user,
        reason: `Cotización #${quote.id} generada.`
      });
      movedTo = { key: quotedColumn.key, label: quotedColumn.label };
    }

    console.log(`💰 [Cotizaciones] Cotización #${quote.id} generada para el lead #${lead.id} (${lead.email})`);

    res.json({ quote, emailStatus, movedTo, previousStatus });
  } catch (error) {
    console.error('❌ Error al generar la cotización:', error);
    res.status(500).json({ error: 'Error al generar la cotización.', details: error.message });
  }
});

/**
 * Historial de cotizaciones de un lead, de la más reciente a la más antigua.
 * El registro siempre se guardó, pero no había forma de consultarlo desde el
 * panel: una vez generada, la cotización solo existía en la pestaña que se
 * abría con el documento.
 */
app.get('/api/leads/:id/quotes', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const quotes = await quoteService.getQuotesByLead(req.params.id);
    res.json({ quotes });
  } catch (error) {
    console.error('❌ Error al obtener las cotizaciones del lead:', error);
    res.status(500).json({ error: 'Error al obtener las cotizaciones del lead.', details: error.message });
  }
});

/**
 * Devuelve el documento HTML imprimible de una cotización con la marca de
 * Avantage Group, listo para "Guardar como PDF" desde el navegador.
 */
app.get('/api/quotes/:id/document', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const data = await quoteService.getQuoteWithLead(req.params.id);
    if (!data || !data.quote || !data.lead) {
      return res.status(404).json({ error: 'Cotización no encontrada.' });
    }

    const html = buildQuotationDocument({ quote: data.quote, lead: data.lead, forPrint: true });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('❌ Error al generar el documento de la cotización:', error);
    res.status(500).json({ error: 'Error al generar el documento de la cotización.', details: error.message });
  }
});

/* ===================================================================== */
/* Contratos                                                              */
/* ===================================================================== */

function sendContractError(res, error, fallback) {
  console.error(`❌ ${fallback}`, error);
  res.status(error.status || 500).json({ error: error.status ? error.message : fallback, details: error.message });
}

app.get('/api/contract-templates', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    res.json(await contractTemplateService.list());
  } catch (error) {
    sendContractError(res, error, 'Error al listar los tipos de contrato.');
  }
});

app.post('/api/contract-templates', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    res.status(201).json(await contractTemplateService.create(req.body || {}));
  } catch (error) {
    sendContractError(res, error, 'Error al crear el tipo de contrato.');
  }
});

app.put('/api/contract-templates/:id', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    const template = await contractTemplateService.update(req.params.id, req.body || {});
    if (!template) return res.status(404).json({ error: 'Tipo de contrato no encontrado.' });
    res.json(template);
  } catch (error) {
    sendContractError(res, error, 'Error al guardar el tipo de contrato.');
  }
});

app.delete('/api/contract-templates/:id', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    if (!await contractTemplateService.remove(req.params.id)) return res.status(404).json({ error: 'Tipo de contrato no encontrado.' });
    res.json({ success: true });
  } catch (error) {
    sendContractError(res, error, 'Error al eliminar el tipo de contrato.');
  }
});

app.get('/api/contracts/client-leads', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    res.json(await contractService.listClientLeads());
  } catch (error) {
    sendContractError(res, error, 'Error al listar los clientes.');
  }
});

/**
 * Módulo de Documentos: cotizaciones y contratos en una sola lista, de lo más
 * reciente a lo más antiguo, buscable por el nombre del lead.
 *
 * Pide `leads.view` (el mismo permiso que las cotizaciones) y añade los
 * contratos SOLO si quien pregunta además tiene `contracts.manage`: este
 * módulo no puede ser la puerta de atrás que se salte ese permiso. La
 * respuesta dice en `kinds` qué se incluyó, para que la pantalla lo explique
 * en vez de mostrar una lista incompleta sin avisar.
 */
app.get('/api/documents', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const result = await documentService.list({
      search: req.query.search || null,
      includeContracts: !!req.user.permissions?.includes('contracts.manage')
    });
    res.json(result);
  } catch (error) {
    console.error('❌ Error al listar los documentos:', error);
    res.status(500).json({ error: 'Error al listar los documentos.', details: error.message });
  }
});

app.get('/api/contracts', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    res.json(await contractService.list({ leadId: req.query.leadId || null }));
  } catch (error) {
    sendContractError(res, error, 'Error al listar los contratos.');
  }
});

app.post('/api/contracts', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    const { templateId, leadId } = req.body || {};
    res.status(201).json(await contractService.create({ templateId, leadId: leadId || null, createdBy: req.user.id }));
  } catch (error) {
    sendContractError(res, error, 'Error al crear el contrato.');
  }
});

app.get('/api/contracts/:id', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    const contract = await contractService.getById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contrato no encontrado.' });
    res.json(contract);
  } catch (error) {
    sendContractError(res, error, 'Error al obtener el contrato.');
  }
});

app.put('/api/contracts/:id', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    const contract = await contractService.update(req.params.id, req.body || {});
    if (!contract) return res.status(404).json({ error: 'Contrato no encontrado.' });
    res.json(contract);
  } catch (error) {
    sendContractError(res, error, 'Error al guardar el contrato.');
  }
});

/**
 * Vuelve a copiar el texto del tipo sobre un contrato en borrador. Es una
 * acción aparte del PUT a propósito: no edita campos, REEMPLAZA el texto
 * entero, y quien la dispara tiene que haberlo confirmado.
 */
app.post('/api/contracts/:id/resync-template', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    const contract = await contractService.resyncFromTemplate(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contrato no encontrado.' });
    res.json(contract);
  } catch (error) {
    sendContractError(res, error, 'Error al actualizar el contrato desde su tipo.');
  }
});

app.delete('/api/contracts/:id', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    if (!await contractService.remove(req.params.id)) return res.status(404).json({ error: 'Contrato no encontrado.' });
    res.json({ success: true });
  } catch (error) {
    sendContractError(res, error, 'Error al eliminar el contrato.');
  }
});

/** Documento HTML A4 del contrato, listo para imprimir o "Guardar como PDF". */
app.get('/api/contracts/:id/document', requireAuth, requirePermission('contracts.manage'), async (req, res) => {
  try {
    const contract = await contractService.getById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contrato no encontrado.' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildContractDocument(contract));
  } catch (error) {
    sendContractError(res, error, 'Error al generar el documento del contrato.');
  }
});

/* ===================================================================== */
/* Campañas de marketing digital                                          */
/* ===================================================================== */

/** Rendimiento en vivo de todas las campañas (embudo real + costos manuales). */
app.get('/api/campaigns/performance', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const { from = null, to = null } = req.query;
    const report = await campaignService.getPerformance({ from, to });
    res.json(report);
  } catch (error) {
    console.error('❌ Error al calcular el rendimiento de campañas:', error);
    res.status(500).json({ error: 'Error al calcular el rendimiento de campañas.', details: error.message });
  }
});

/**
 * El mismo rendimiento pero como libro de Excel (.xlsx): abre con la hoja
 * "Atribución anuncio → venta" —una fila por campaña > conjunto > anuncio que
 * cruza la inversión de Meta con las ventas reales del CRM, ordenada por
 * ingreso—, seguida de las hojas "Anuncios" y "Conjuntos de anuncios" con las
 * columnas del informe del Administrador de anuncios y de "Campañas" con el
 * agregado por campaña más el funnel del CRM.
 *
 * `campaignIds` (opcional, separados por coma) limita la exportación a las
 * campañas que el usuario tenga filtradas en pantalla.
 */
app.get('/api/campaigns/performance/export', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const { from = null, to = null, campaignIds = null } = req.query;
    const ids = campaignIds
      ? String(campaignIds).split(',').map((v) => Number(v.trim())).filter(Number.isFinite)
      : null;

    const { workbook, filename } = await campaignExportService.buildWorkbook({ from, to, campaignIds: ids });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('❌ Error al exportar el rendimiento de campañas:', error);
    // Si ya se empezó a escribir el libro no se puede responder JSON.
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Error al exportar el rendimiento de campañas.', details: error.message });
  }
});

/**
 * Imagen del anuncio de Meta (thumbnail del creativo) que representa a la
 * campaña, servida desde la copia local que guarda metaAdsService.sync().
 * Responde 404 si la campaña no tiene imagen — el frontend muestra un
 * ícono de respaldo en su lugar.
 */
app.get('/api/campaigns/:id/ads/:adId/image', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const image = await campaignService.getAdCreativeImage(req.params.id, req.params.adId);
    if (!image) return res.status(404).end();
    res.type(image.mimeType);
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(image.path);
  } catch (error) {
    console.error('❌ Error al servir la imagen del anuncio:', error);
    res.status(500).end();
  }
});

app.get('/api/campaigns/:id/image', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const campaign = await campaignService.getCampaign(req.params.id);
    if (!campaign || !campaign.ad_image_filename) return res.status(404).end();
    res.type(campaign.ad_image_mime_type || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.join(campaignAdImageDir, campaign.ad_image_filename));
  } catch (error) {
    console.error('❌ Error al servir la imagen de la campaña:', error);
    res.status(404).end();
  }
});

/** Lista de campañas con su mapeo de anuncios. */
app.get('/api/campaigns', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    res.json({ campaigns: await campaignService.listCampaigns() });
  } catch (error) {
    console.error('❌ Error al listar campañas:', error);
    res.status(500).json({ error: 'Error al listar campañas.', details: error.message });
  }
});

app.post('/api/campaigns', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    if (!req.body?.name || !String(req.body.name).trim()) {
      return res.status(400).json({ error: 'La campaña necesita un nombre.' });
    }
    const campaign = await campaignService.createCampaign(req.body);
    res.status(201).json({ campaign });
  } catch (error) {
    console.error('❌ Error al crear la campaña:', error);
    res.status(500).json({ error: 'Error al crear la campaña.', details: error.message });
  }
});

app.put('/api/campaigns/:id', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const campaign = await campaignService.updateCampaign(req.params.id, req.body);
    if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada.' });
    res.json({ campaign });
  } catch (error) {
    console.error('❌ Error al actualizar la campaña:', error);
    res.status(500).json({ error: 'Error al actualizar la campaña.', details: error.message });
  }
});

app.delete('/api/campaigns/:id', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    await campaignService.deleteCampaign(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar la campaña:', error);
    res.status(500).json({ error: 'Error al eliminar la campaña.', details: error.message });
  }
});

/** Asocia un ID de anuncio (source_id del referral) a una campaña. */
app.post('/api/campaigns/:id/ads', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const campaign = await campaignService.addAdMapping(req.params.id, {
      adSourceId: req.body?.adSourceId,
      adLabel: req.body?.adLabel
    });
    if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada.' });
    res.status(201).json({ campaign });
  } catch (error) {
    console.error('❌ Error al mapear el anuncio:', error);
    res.status(400).json({ error: error.message || 'Error al mapear el anuncio.' });
  }
});

app.delete('/api/campaigns/ads/:mappingId', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    await campaignService.removeAdMapping(req.params.mappingId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al quitar el mapeo del anuncio:', error);
    res.status(500).json({ error: 'Error al quitar el mapeo del anuncio.', details: error.message });
  }
});

/** Estado de la integración con la Meta Marketing API (Ads). */
app.get('/api/campaigns/meta/status', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    res.json(await metaAdsService.status());
  } catch (error) {
    res.json({ configured: false, reason: 'error', error: error.message });
  }
});

/**
 * Sincroniza las campañas de Meta Ads: importa campañas, mapea sus anuncios
 * (para atribuir el tráfico Click-to-WhatsApp) y trae las métricas de
 * rendimiento (gasto, impresiones, alcance, clics, CPM, CTR).
 */
app.post('/api/campaigns/meta/sync', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const datePreset = ['today', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'maximum'].includes(req.body?.datePreset)
      ? req.body.datePreset
      : 'last_30d';
    const summary = await metaAdsService.sync({ datePreset });
    console.log(`📊 [Campañas] Sync Meta: ${summary.campaigns} campañas, ${summary.adsMapped} anuncios, ${summary.insightsUpdated} con métricas.`);
    res.json({ summary });
  } catch (error) {
    console.error('❌ Error al sincronizar con Meta Ads:', error);
    const configErrors = ['NOT_CONFIGURED', 'NO_TOKEN', 'NO_AD_ACCOUNT'];
    const status = configErrors.includes(error.code) ? 400 : 502;
    res.status(status).json({ error: error.message, code: error.code || null, metaCode: error.metaCode || null });
  }
});

/* ---------------------- TikTok Ads (Marketing API) --------------------- */

/**
 * Paso 1 de la conexión: la URL del portal de autorización de TikTok. El
 * anunciante la abre, elige qué cuentas publicitarias autoriza y TikTok
 * redirige al `redirect_uri` con un `auth_code` de un solo uso.
 */
app.get('/api/campaigns/tiktok/auth-url', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const url = tiktokAdsService.authorizationUrl({
      redirectUri: req.query.redirectUri || process.env.TIKTOK_REDIRECT_URI || null
    });
    res.json({ url });
  } catch (error) {
    res.status(400).json({ error: error.message, code: error.code || null });
  }
});

/**
 * Paso 2: canjea el `auth_code` de la redirección por el access token de larga
 * duración. Se devuelve para copiarlo a `TIKTOK_ACCESS_TOKEN` en el `.env` —no
 * se persiste en la base ni se escribe en el log— porque el token no caduca y
 * el resto de credenciales del proyecto viven ahí mismo.
 */
app.post('/api/campaigns/tiktok/exchange-code', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const result = await tiktokAdsService.exchangeAuthCode(req.body?.authCode);
    console.log(`🔑 [Campañas] TikTok autorizó ${result.advertiserIds.length} cuenta(s) publicitaria(s).`);
    res.json(result);
  } catch (error) {
    console.error('❌ Error al canjear el auth_code de TikTok:', error.message);
    const configErrors = ['NOT_CONFIGURED', 'NO_AUTH_CODE'];
    const status = configErrors.includes(error.code) ? 400 : 502;
    res.status(status).json({ error: error.message, code: error.code || null, tiktokCode: error.tiktokCode || null });
  }
});

/** Estado de la integración con la TikTok Business API. */
app.get('/api/campaigns/tiktok/status', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    res.json(await tiktokAdsService.status());
  } catch (error) {
    res.json({ configured: false, reason: 'error', error: error.message });
  }
});

/**
 * Sincroniza las campañas de TikTok Ads: importa la jerarquía completa
 * (campaña → grupo de anuncios → anuncio) y trae las métricas del informe
 * (gasto, resultados, alcance, impresiones, CPM, clics, CTR y CPC).
 */
app.post('/api/campaigns/tiktok/sync', requireAuth, requirePermission('leads.view'), async (req, res) => {
  try {
    const datePreset = ['today', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'maximum'].includes(req.body?.datePreset)
      ? req.body.datePreset
      : 'last_30d';
    const summary = await tiktokAdsService.sync({ datePreset });
    console.log(`📊 [Campañas] Sync TikTok: ${summary.campaigns} campañas, ${summary.ads} anuncios, ${summary.insightsUpdated} con métricas.`);
    res.json({ summary });
  } catch (error) {
    console.error('❌ Error al sincronizar con TikTok Ads:', error);
    const configErrors = ['NOT_CONFIGURED', 'NO_TOKEN', 'NO_AD_ACCOUNT'];
    const status = configErrors.includes(error.code) ? 400 : 502;
    res.status(status).json({ error: error.message, code: error.code || null, tiktokCode: error.tiktokCode || null });
  }
});

/**
 * Directorio ligero de usuarios internos, para asignar líder/colaboradores a
 * un proyecto (no requiere el permiso roles.manage, a diferencia de /api/users).
 */
app.get('/api/team-directory', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const users = await userService.listDirectory();
    res.json({ users });
  } catch (error) {
    console.error('❌ Error al obtener el directorio de equipo:', error);
    res.status(500).json({ error: 'Error al obtener el directorio de equipo.', details: error.message });
  }
});

/**
 * Listado de proyectos generados a partir de leads ganados
 */
app.get('/api/projects', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const projects = await projectService.getAllProjects();
    res.json({ total: projects.length, projects });
  } catch (error) {
    console.error('❌ Error al obtener proyectos:', error);
    res.status(500).json({ error: 'Error al obtener los proyectos desde la base de datos.', details: error.message });
  }
});

/**
 * Crear un proyecto manualmente (sin que provenga de un lead ganado en el funnel)
 */
app.post('/api/projects', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { topic, clientEmail, clientPhone, academicLevel, fieldOfStudy, deadline } = req.body;

    if (!topic || !topic.trim()) {
      return res.status(400).json({ error: 'El tema/nombre del proyecto es requerido.' });
    }
    if (!clientEmail || !clientEmail.includes('@')) {
      return res.status(400).json({ error: 'Proporcione un correo de cliente válido.' });
    }
    if (!clientPhone || !clientPhone.trim()) {
      return res.status(400).json({ error: 'El celular del cliente es requerido.' });
    }
    if (!academicLevel || !academicLevel.trim()) {
      return res.status(400).json({ error: 'El nivel académico es requerido.' });
    }
    if (!fieldOfStudy || !fieldOfStudy.trim()) {
      return res.status(400).json({ error: 'La carrera / campo de estudio es requerido.' });
    }

    const project = await projectService.createManualProject({
      topic: topic.trim(),
      clientEmail: clientEmail.trim(),
      clientPhone: clientPhone.trim(),
      academicLevel: academicLevel.trim(),
      fieldOfStudy: fieldOfStudy.trim(),
      deadline
    });

    console.log(`🚀 [Proyectos] Proyecto #${project.id} creado manualmente (sin lead asociado)`);
    res.json({ project });
  } catch (error) {
    console.error('❌ Error al crear el proyecto:', error);
    res.status(500).json({ error: 'Error al crear el proyecto.', details: error.message });
  }
});

/**
 * Editar los datos de un proyecto (tema, cliente, nivel, carrera, plazo).
 *
 * A propósito no pasa por `guardProjectManageable`: el bloqueo por pago sin
 * verificar impide trabajar el proyecto, no corregir los datos con los que se
 * creó (un correo mal escrito, por ejemplo, hay que poder arreglarlo antes).
 */
app.put('/api/projects/:id', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const project = await projectService.updateProject(req.params.id, req.body || {});
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    res.json({ project });
  } catch (error) {
    console.error('❌ Error al editar el proyecto:', error);
    res.status(400).json({ error: error.message || 'Error al editar el proyecto.' });
  }
});

/**
 * Eliminar un proyecto con sus tareas, colaboradores y línea de tiempo. Los
 * ingresos del lead siguen intactos en Finanzas: el dinero no se borra junto
 * con el proyecto.
 */
app.delete('/api/projects/:id', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const project = await projectService.deleteProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    console.log(`🗑️ [Proyectos] Proyecto #${project.id} eliminado por ${req.user.email}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el proyecto:', error);
    res.status(500).json({ error: 'Error al eliminar el proyecto.', details: error.message });
  }
});

/**
 * Envuelve una ruta que modifica un proyecto: si su primer pago todavía no lo
 * verificó Finanzas, el proyecto es de solo lectura y se responde 409 con el
 * motivo, en vez de dejar que el cambio entre por la API sin pasar por la UI.
 */
async function guardProjectManageable(projectId, res) {
  try {
    const project = await projectService.assertManageable(projectId);
    if (!project) {
      res.status(404).json({ error: 'Proyecto no encontrado.' });
      return false;
    }
    // Devuelve el proyecto (no `true`) para que quien lo necesite —atar un
    // avance a una cuota del cliente— no lo tenga que volver a leer. Los
    // callers que solo cortan con `if (!await guard(...)) return;` siguen
    // funcionando igual: un proyecto es un valor verdadero.
    return project;
  } catch (error) {
    if (error.code === 'PROJECT_LOCKED') {
      res.status(409).json({ error: error.message, projectLocked: true });
      return false;
    }
    throw error;
  }
}

/**
 * Actualizar el estado de ejecución de un proyecto
 */
app.patch('/api/projects/:id/status', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ error: 'El estado (status) es requerido.' });
    }
    if (!await guardProjectManageable(req.params.id, res)) return;
    const project = await projectService.updateProjectStatus(req.params.id, status);
    if (!project) {
      return res.status(404).json({ error: 'Proyecto no encontrado.' });
    }
    res.json({ project });
  } catch (error) {
    console.error('❌ Error al actualizar el proyecto:', error);
    res.status(500).json({ error: 'Error al actualizar el proyecto.', details: error.message });
  }
});

/**
 * Establecer o limpiar el plazo (deadline) de un proyecto
 */
app.patch('/api/projects/:id/deadline', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { deadline } = req.body;
    if (!await guardProjectManageable(req.params.id, res)) return;
    const project = await projectService.updateDeadline(req.params.id, deadline);
    if (!project) {
      return res.status(404).json({ error: 'Proyecto no encontrado.' });
    }
    res.json({ project });
  } catch (error) {
    console.error('❌ Error al actualizar el plazo del proyecto:', error);
    res.status(500).json({ error: 'Error al actualizar el plazo del proyecto.', details: error.message });
  }
});

/**
 * Asignar (o quitar) el líder responsable de un proyecto
 */
app.patch('/api/projects/:id/leader', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!await guardProjectManageable(req.params.id, res)) return;
    const project = await projectService.updateLeader(req.params.id, userId);
    if (!project) {
      return res.status(404).json({ error: 'Proyecto no encontrado.' });
    }
    res.json({ project });
  } catch (error) {
    console.error('❌ Error al asignar el líder del proyecto:', error);
    res.status(500).json({ error: 'Error al asignar el líder del proyecto.', details: error.message });
  }
});

/**
 * Agregar un colaborador a un proyecto
 */
app.post('/api/projects/:id/collaborators', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido.' });
    }
    if (!await guardProjectManageable(req.params.id, res)) return;
    const project = await projectService.addCollaborator(req.params.id, userId);
    res.json({ project });
  } catch (error) {
    console.error('❌ Error al agregar el colaborador:', error);
    res.status(500).json({ error: 'Error al agregar el colaborador.', details: error.message });
  }
});

/**
 * Quitar un colaborador de un proyecto
 */
app.delete('/api/projects/:id/collaborators/:userId', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    if (!await guardProjectManageable(req.params.id, res)) return;
    const project = await projectService.removeCollaborator(req.params.id, req.params.userId);
    res.json({ project });
  } catch (error) {
    console.error('❌ Error al quitar el colaborador:', error);
    res.status(500).json({ error: 'Error al quitar el colaborador.', details: error.message });
  }
});

/**
 * Detalle de un proyecto específico (incluye % de avance)
 */
app.get('/api/projects/:id', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const project = await projectService.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Proyecto no encontrado.' });
    }
    res.json({ project });
  } catch (error) {
    console.error('❌ Error al obtener el proyecto:', error);
    res.status(500).json({ error: 'Error al obtener el proyecto desde la base de datos.', details: error.message });
  }
});

/**
 * Listado de tareas de un proyecto (checklist + tablero Kanban)
 */
app.get('/api/projects/:id/tasks', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const tasks = await taskService.getTasksByProject(req.params.id);
    res.json({ total: tasks.length, tasks });
  } catch (error) {
    console.error('❌ Error al obtener las tareas:', error);
    res.status(500).json({ error: 'Error al obtener las tareas del proyecto.', details: error.message });
  }
});

/**
 * Crear una nueva tarea para un proyecto
 */
app.post('/api/projects/:id/tasks', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'El título de la tarea es requerido.' });
    }
    if (!await guardProjectManageable(req.params.id, res)) return;
    const task = await taskService.createTask(req.params.id, title.trim());
    res.json({ task });
  } catch (error) {
    console.error('❌ Error al crear la tarea:', error);
    res.status(500).json({ error: 'Error al crear la tarea.', details: error.message });
  }
});

/**
 * Importar al proyecto las tareas de una plantilla guardada.
 */
app.post('/api/projects/:id/tasks/import', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { templateId } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'Indica la plantilla a importar.' });
    if (!await guardProjectManageable(req.params.id, res)) return;

    const result = await taskTemplateService.applyToProject(templateId, req.params.id);
    res.json(result);
  } catch (error) {
    console.error('❌ Error al importar la plantilla de tareas:', error);
    res.status(400).json({ error: error.message || 'Error al importar la plantilla.' });
  }
});

// =====================================================================
// PLANTILLAS DE TAREAS (/api/task-templates)
// =====================================================================
// Conjuntos de tareas guardados con nombre (y universidad, cuando el esquema
// es propio de una) para no volver a tipear la misma lista en cada proyecto.

app.get('/api/task-templates', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const [templates, universities] = await Promise.all([
      taskTemplateService.listTemplates({ search: req.query.search, university: req.query.university }),
      taskTemplateService.listUniversities()
    ]);
    res.json({ templates, universities });
  } catch (error) {
    console.error('❌ Error al obtener las plantillas de tareas:', error);
    res.status(500).json({ error: 'Error al obtener las plantillas.', details: error.message });
  }
});

/**
 * Crea una plantilla, ya sea con la lista de tareas que mande la pantalla o
 * copiando las que ya tiene un proyecto (`projectId`).
 */
app.post('/api/task-templates', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { name, university, academicLevel, items, projectId } = req.body || {};
    const template = projectId
      ? await taskTemplateService.createTemplateFromProject(projectId, { name, university, academicLevel, createdBy: req.user.id })
      : await taskTemplateService.createTemplate({ name, university, academicLevel, items, createdBy: req.user.id });
    res.status(201).json({ template });
  } catch (error) {
    console.error('❌ Error al crear la plantilla de tareas:', error);
    res.status(400).json({ error: error.message || 'Error al crear la plantilla.' });
  }
});

app.put('/api/task-templates/:id', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const template = await taskTemplateService.updateTemplate(req.params.id, req.body || {});
    if (!template) return res.status(404).json({ error: 'Plantilla no encontrada.' });
    res.json({ template });
  } catch (error) {
    console.error('❌ Error al editar la plantilla de tareas:', error);
    res.status(400).json({ error: error.message || 'Error al editar la plantilla.' });
  }
});

app.delete('/api/task-templates/:id', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    await taskTemplateService.deleteTemplate(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar la plantilla de tareas:', error);
    res.status(500).json({ error: 'Error al eliminar la plantilla.', details: error.message });
  }
});

/**
 * Actualizar el estado de una tarea (columna del Kanban de tareas)
 */
app.patch('/api/tasks/:id/status', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ error: 'El estado (status) es requerido.' });
    }
    const existingTask = await taskService.getTaskById(req.params.id);
    if (!existingTask) {
      return res.status(404).json({ error: 'Tarea no encontrada.' });
    }
    if (!await guardProjectManageable(existingTask.project_id, res)) return;
    const task = await taskService.updateTaskStatus(req.params.id, status);
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada.' });
    }
    res.json({ task });
  } catch (error) {
    console.error('❌ Error al actualizar la tarea:', error);
    res.status(500).json({ error: 'Error al actualizar la tarea.', details: error.message });
  }
});

/**
 * Eliminar una tarea
 */
app.delete('/api/tasks/:id', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (task && !await guardProjectManageable(task.project_id, res)) return;
    await taskService.deleteTask(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar la tarea:', error);
    res.status(500).json({ error: 'Error al eliminar la tarea.', details: error.message });
  }
});

/**
 * Línea de tiempo: listado de hitos/actualizaciones de un proyecto
 */
app.get('/api/projects/:id/updates', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const updates = await projectUpdateService.getUpdatesByProject(req.params.id);
    res.json({ total: updates.length, updates });
  } catch (error) {
    console.error('❌ Error al obtener la línea de tiempo:', error);
    res.status(500).json({ error: 'Error al obtener la línea de tiempo del proyecto.', details: error.message });
  }
});

/**
 * Publicar un nuevo hito en la línea de tiempo (texto y, opcionalmente, un
 * documento adjunto vía multipart/form-data, campo "attachment").
 */
app.post('/api/projects/:id/updates', requireAuth, requirePermission('projects.view'), uploadProjectUpdateAttachment, async (req, res) => {
  try {
    const { content, incomeId } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'El contenido de la actualización es requerido.' });
    }
    const project = await guardProjectManageable(req.params.id, res);
    if (!project) return;

    // Si el avance se entrega contra una cuota, tiene que ser una cuota DE
    // ESTE cliente: de lo contrario el adjunto se liberaría con el pago de
    // otro proyecto.
    let unlockIncomeId = null;
    if (incomeId) {
      const income = await financeLedgerService.getIncomeById(incomeId);
      if (!income || income.lead_id !== project.lead_id) {
        return res.status(400).json({ error: 'La cuota indicada no pertenece a este proyecto.' });
      }
      unlockIncomeId = income.id;
    }

    const update = await projectUpdateService.createUpdate({
      projectId: req.params.id,
      authorId: req.user.id,
      content: content.trim(),
      attachment: req.file || null,
      incomeId: unlockIncomeId
    });
    res.json({ update });
  } catch (error) {
    console.error('❌ Error al publicar la actualización:', error);
    res.status(500).json({ error: 'Error al publicar la actualización.', details: error.message });
  }
});

/**
 * Cronograma de pagos del proyecto: alimenta el selector "se libera con la
 * cuota…" del formulario de avances y la vista de cobros del proyecto.
 */
app.get('/api/projects/:id/payments', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const project = await projectService.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    const payments = await financeLedgerService.listScheduleByLead(project.lead_id);
    res.json({ payments });
  } catch (error) {
    console.error('❌ Error al obtener el cronograma del proyecto:', error);
    res.status(500).json({ error: 'Error al obtener el cronograma del proyecto.', details: error.message });
  }
});

/**
 * Ata (o desata, mandando `incomeId: null`) un avance ya publicado a la cuota
 * que libera su adjunto, sin tener que volver a subir el archivo.
 *
 * Lo usan los dos módulos que ven ese vínculo: el detalle del proyecto y el
 * tablero de Entregables (que es donde se detecta un entregable subido sin
 * cobro asociado), así que acepta cualquiera de los dos permisos.
 */
app.patch('/api/project-updates/:id/unlock-income', requireAuth, requireAnyPermission('projects.view', 'deliverables.view'), async (req, res) => {
  try {
    const update = await projectUpdateService.getUpdateById(req.params.id);
    if (!update) return res.status(404).json({ error: 'Actualización no encontrada.' });
    if (!await guardProjectManageable(update.project_id, res)) return;

    const { incomeId } = req.body || {};
    if (incomeId) {
      const project = await projectService.getProjectById(update.project_id);
      const income = await financeLedgerService.getIncomeById(incomeId);
      if (!income || income.lead_id !== project.lead_id) {
        return res.status(400).json({ error: 'La cuota indicada no pertenece a este proyecto.' });
      }
    }
    res.json({ update: await projectUpdateService.setUnlockIncome(req.params.id, incomeId || null) });
  } catch (error) {
    console.error('❌ Error al atar el avance a una cuota:', error);
    res.status(400).json({ error: error.message || 'Error al atar el avance a una cuota.' });
  }
});

/**
 * Elimina un hito de la línea de tiempo (y su adjunto del disco).
 *
 * Pasa por la puerta del pago verificado como el resto de la gestión del
 * proyecto: si no se puede publicar un avance, tampoco borrarlo. El cliente
 * deja de verlo en su portal en cuanto se borra, esté o no atado a una cuota.
 */
app.delete('/api/project-updates/:id', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const existing = await projectUpdateService.getUpdateById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Actualización no encontrada.' });
    if (!await guardProjectManageable(existing.project_id, res)) return;

    const update = await projectUpdateService.deleteUpdate(req.params.id);
    if (update?.attachment_filename) {
      fs.unlink(path.join(uploadDir, update.attachment_filename), () => {});
    }
    console.log(`🗑️ [Proyectos] Hito #${req.params.id} del proyecto #${existing.project_id} eliminado por ${req.user.email}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar la actualización:', error);
    res.status(500).json({ error: 'Error al eliminar la actualización.', details: error.message });
  }
});

/**
 * Descarga del documento adjunto de una actualización (requiere sesión y
 * permiso projects.view, igual que el resto del módulo de proyectos)
 */
app.get('/api/project-updates/:id/attachment', requireAuth, requirePermission('projects.view'), async (req, res) => {
  try {
    const update = await projectUpdateService.getUpdateById(req.params.id);
    if (!update || !update.attachment_filename) {
      return res.status(404).json({ error: 'Adjunto no encontrado.' });
    }
    const filePath = path.join(uploadDir, update.attachment_filename);
    res.download(filePath, update.attachment_original_name || update.attachment_filename);
  } catch (error) {
    console.error('❌ Error al descargar el adjunto:', error);
    res.status(500).json({ error: 'Error al descargar el adjunto.', details: error.message });
  }
});

// ---------------------------------------------------------------- ENTREGABLES

/**
 * Las entregas de cada proyecto (tabla `deliverables`), cruzadas con el estado
 * de la cuota que las condiciona. Responde de un golpe la pregunta operativa:
 * ¿esto ya se entregó y el pago ya está verificado?
 *
 * Las entregas ya no se liberan por el portal del cliente: ocurren fuera del
 * sistema y se registran acá, así que este módulo es el que sabe qué FALTA
 * entregar — algo que ninguna de las tablas anteriores podía decir.
 */
app.get('/api/deliverables', requireAuth, requirePermission('deliverables.view'), async (req, res) => {
  try {
    res.json(await deliverableService.getOverview());
  } catch (error) {
    console.error('❌ Error al obtener el tablero de entregables:', error);
    res.status(500).json({ error: 'Error al obtener el tablero de entregables.', details: error.message });
  }
});

/**
 * La cuota que condiciona una entrega tiene que ser del MISMO cliente: si no, el
 * entregable quedaría atado al pago de otro proyecto. Se comprueba en el alta y
 * en la edición, que son los dos sitios por donde entra ese dato.
 */
async function assertIncomeBelongsToProject(projectId, incomeId, res) {
  if (!incomeId) return true;
  const project = await projectService.getProjectById(projectId);
  const income = await financeLedgerService.getIncomeById(incomeId);
  if (!income || !project || income.lead_id !== project.lead_id) {
    res.status(400).json({ error: 'La cuota indicada no pertenece a este proyecto.' });
    return false;
  }
  return true;
}

/** Alta de un entregable planificado. */
app.post('/api/deliverables', requireAuth, requirePermission('deliverables.view'), async (req, res) => {
  try {
    const { projectId, title, description, dueDate, incomeId } = req.body || {};
    if (!projectId) return res.status(400).json({ error: 'El proyecto es obligatorio.' });
    const project = await projectService.getProjectById(projectId);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    if (!await assertIncomeBelongsToProject(projectId, incomeId, res)) return;

    const deliverable = await deliverableService.create({
      projectId, title, description, dueDate, incomeId, createdBy: req.user.id
    });
    res.json({ deliverable });
  } catch (error) {
    console.error('❌ Error al crear el entregable:', error);
    res.status(400).json({ error: error.message || 'Error al crear el entregable.' });
  }
});

/** Edición del plan (título, descripción, fecha pactada, cuota que lo condiciona). */
app.put('/api/deliverables/:id', requireAuth, requirePermission('deliverables.view'), async (req, res) => {
  try {
    const existing = await deliverableService.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Entregable no encontrado.' });

    const { title, description, dueDate, incomeId, notes } = req.body || {};
    if (incomeId !== undefined && !await assertIncomeBelongsToProject(existing.project_id, incomeId, res)) return;

    res.json({ deliverable: await deliverableService.update(req.params.id, { title, description, dueDate, incomeId, notes }) });
  } catch (error) {
    console.error('❌ Error al editar el entregable:', error);
    res.status(400).json({ error: error.message || 'Error al editar el entregable.' });
  }
});

/**
 * Marca la entrega: cuándo, por qué canal y, si se quiere, con una copia del
 * archivo entregado (multipart, campo "attachment").
 *
 * No se exige que la cuota esté verificada: entregar sin el pago confirmado
 * pasa, y taparlo sería peor que registrarlo — el tablero lo muestra como
 * "Entregado sin cobrar", que es lo que es.
 */
app.post('/api/deliverables/:id/deliver', requireAuth, requirePermission('deliverables.view'), uploadDeliverableAttachment, async (req, res) => {
  try {
    const existing = await deliverableService.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Entregable no encontrado.' });

    const { deliveredAt, channel, notes } = req.body || {};
    const { deliverable, replacedFile } = await deliverableService.markDelivered(req.params.id, {
      deliveredAt, channel, notes, deliveredBy: req.user.id, attachment: req.file || null
    });
    // El archivo anterior ya no lo referencia nadie.
    if (replacedFile) fs.unlink(path.join(deliverableDir, replacedFile), () => {});
    res.json({ deliverable });
  } catch (error) {
    // Multer ya dejó el archivo en disco antes de llegar acá: si la entrega no
    // se registra, ese archivo no lo referencia nadie.
    if (req.file) fs.unlink(path.join(deliverableDir, req.file.filename), () => {});
    // La cuota sin pagar no es un error de quien lo intentó: es un estado del
    // cobro, y el panel lo muestra como aviso y no como falla.
    if (error.code === 'UNPAID_INCOME') return res.status(409).json({ error: error.message });
    console.error('❌ Error al registrar la entrega:', error);
    res.status(400).json({ error: error.message || 'Error al registrar la entrega.' });
  }
});

/** Deshace la marca de entregado (se marcó por error). El archivo se conserva. */
app.post('/api/deliverables/:id/undeliver', requireAuth, requirePermission('deliverables.view'), async (req, res) => {
  try {
    const existing = await deliverableService.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Entregable no encontrado.' });
    res.json({ deliverable: await deliverableService.markPending(req.params.id) });
  } catch (error) {
    console.error('❌ Error al revertir la entrega:', error);
    res.status(400).json({ error: error.message || 'Error al revertir la entrega.' });
  }
});

/**
 * Copia al proyecto el cronograma de entregas del contrato vigente del cliente.
 * Copia y no lee en vivo: un contrato emitido es inmutable, así que reprogramar
 * una entrega no puede reescribir un documento ya firmado. Saltea las que ya
 * existen con el mismo título, así que reimportar no duplica nada.
 */
app.post('/api/projects/:id/deliverables/import-contract', requireAuth, requirePermission('deliverables.view'), async (req, res) => {
  try {
    res.json(await deliverableService.importFromContract(req.params.id, { createdBy: req.user.id }));
  } catch (error) {
    console.error('❌ Error al importar el cronograma de entregas del contrato:', error);
    res.status(400).json({ error: error.message || 'Error al importar el cronograma de entregas.' });
  }
});

/** Descarga de la copia de respaldo del archivo entregado. */
app.get('/api/deliverables/:id/attachment', requireAuth, requirePermission('deliverables.view'), async (req, res) => {
  try {
    const deliverable = await db('deliverables').where({ id: req.params.id }).first();
    if (!deliverable?.attachment_filename) return res.status(404).json({ error: 'Este entregable no tiene archivo guardado.' });
    res.download(path.join(deliverableDir, deliverable.attachment_filename), deliverable.attachment_original_name || deliverable.attachment_filename);
  } catch (error) {
    console.error('❌ Error al descargar el archivo entregado:', error);
    res.status(500).json({ error: 'Error al descargar el archivo entregado.', details: error.message });
  }
});

app.delete('/api/deliverables/:id', requireAuth, requirePermission('deliverables.view'), async (req, res) => {
  try {
    const removed = await deliverableService.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Entregable no encontrado.' });
    if (removed.attachment_filename) fs.unlink(path.join(deliverableDir, removed.attachment_filename), () => {});
    console.log(`[Entregables] Entregable #${req.params.id} eliminado por ${req.user.email}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar el entregable:', error);
    res.status(500).json({ error: 'Error al eliminar el entregable.', details: error.message });
  }
});

/**
 * Listado de roles con sus permisos (herramientas habilitadas)
 */
app.get('/api/roles', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const roles = await roleService.listRoles();
    res.json({ roles });
  } catch (error) {
    console.error('❌ Error al obtener roles:', error);
    res.status(500).json({ error: 'Error al obtener los roles.', details: error.message });
  }
});

/**
 * Crear un nuevo rol
 */
app.post('/api/roles', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'El nombre del rol es requerido.' });
    }
    const role = await roleService.createRole({ name: name.trim(), description });
    res.json({ role });
  } catch (error) {
    console.error('❌ Error al crear el rol:', error);
    res.status(500).json({ error: 'Error al crear el rol. Verifica que el nombre no esté repetido.', details: error.message });
  }
});

/**
 * Reemplaza el conjunto completo de permisos (herramientas) de un rol
 */
app.put('/api/roles/:id/permissions', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const { permissionIds } = req.body;
    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ error: 'permissionIds debe ser un arreglo.' });
    }
    const role = await roleService.setRolePermissions(req.params.id, permissionIds);
    res.json({ role });
  } catch (error) {
    console.error('❌ Error al actualizar los permisos del rol:', error);
    res.status(500).json({ error: 'Error al actualizar los permisos del rol.', details: error.message });
  }
});

/**
 * Listado de permisos (herramientas internas existentes o por desarrollarse)
 */
app.get('/api/permissions', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const permissions = await roleService.listPermissions();
    res.json({ permissions });
  } catch (error) {
    console.error('❌ Error al obtener permisos:', error);
    res.status(500).json({ error: 'Error al obtener los permisos.', details: error.message });
  }
});

/**
 * Registrar una nueva herramienta (permiso), aunque su módulo aún no exista,
 * para poder asignarla a roles desde ya.
 */
app.post('/api/permissions', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const { key, label } = req.body;
    if (!key || !key.trim() || !label || !label.trim()) {
      return res.status(400).json({ error: 'La clave (key) y el nombre (label) de la herramienta son requeridos.' });
    }
    const permission = await roleService.createPermission({ key: key.trim(), label: label.trim() });
    res.json({ permission });
  } catch (error) {
    console.error('❌ Error al crear el permiso:', error);
    res.status(500).json({ error: 'Error al crear la herramienta. Verifica que la clave no esté repetida.', details: error.message });
  }
});

/**
 * Listado de usuarios internos
 */
app.get('/api/users', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const users = await userService.listUsers();
    res.json({ users });
  } catch (error) {
    console.error('❌ Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error al obtener los usuarios.', details: error.message });
  }
});

/**
 * Crear un nuevo usuario interno
 */
app.post('/api/users', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const { name, email, password, roleId } = req.body;
    if (!name || !email || !password || !roleId) {
      return res.status(400).json({ error: 'Nombre, correo, contraseña y rol son requeridos.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    const user = await userService.createUser({ name: name.trim(), email: email.trim(), password, roleId });
    res.json({ user });
  } catch (error) {
    console.error('❌ Error al crear el usuario:', error);
    res.status(500).json({ error: 'Error al crear el usuario. Verifica que el correo no esté registrado.', details: error.message });
  }
});

/**
 * Reasignar el rol de un usuario
 */
app.patch('/api/users/:id/role', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const { roleId } = req.body;
    if (!roleId) {
      return res.status(400).json({ error: 'roleId es requerido.' });
    }
    const user = await userService.updateUserRole(req.params.id, roleId);
    res.json({ user });
  } catch (error) {
    console.error('❌ Error al actualizar el rol del usuario:', error);
    res.status(500).json({ error: 'Error al actualizar el rol del usuario.', details: error.message });
  }
});

/**
 * Administración de las cuentas del portal de clientes (no confundir con
 * `/api/users`, que son las cuentas internas del equipo): mismo permiso
 * `roles.manage`, vive en la pestaña "Clientes del portal" de /admin/roles.
 * Nunca se envían `password_hash`, `activation_token` ni `reset_token` al
 * frontend — solo si la cuenta está activada/pendiente y si el token vigente
 * ya expiró.
 */
function toClientAccountSummary(account) {
  const now = new Date();
  const inviteExpired = Boolean(
    account.activation_token && account.activation_token_expires_at && new Date(account.activation_token_expires_at) < now
  );
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    project_count: account.project_count ?? 0,
    is_activated: Boolean(account.password_hash),
    invite_pending: !account.password_hash,
    invite_expired: inviteExpired,
    last_login_at: account.last_login_at,
    created_at: account.created_at
  };
}

app.get('/api/client-accounts', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const accounts = await clientAccountService.listAll();
    res.json({ accounts: accounts.map(toClientAccountSummary) });
  } catch (error) {
    console.error('❌ Error al obtener las cuentas del portal de clientes:', error);
    res.status(500).json({ error: 'Error al obtener las cuentas del portal.', details: error.message });
  }
});

app.post('/api/client-accounts', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const { email, name } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Proporcione un correo válido.' });
    }

    const { account, isNew } = await clientAccountService.ensureAccountForEmail(email, name);
    if (!isNew) {
      return res.status(409).json({ error: 'Ya existe una cuenta del portal con ese correo. Usa "Reenviar invitación" en su lugar.' });
    }

    const activationUrl = `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/portal/activar?token=${account.activation_token}`;
    const result = await emailService.sendClientPortalInviteEmail(account.email, { name: account.name, activationUrl });
    if (!result?.success) {
      console.warn(`⚠️ [Portal] No se pudo enviar la invitación manual a ${account.email}:`, result?.error);
    }

    res.status(201).json({ account: toClientAccountSummary(account), emailSent: Boolean(result?.success) });
  } catch (error) {
    console.error('❌ Error al invitar al cliente al portal:', error);
    res.status(400).json({ error: error.message || 'No se pudo invitar al cliente.' });
  }
});

app.post('/api/client-accounts/:id/reenviar-invitacion', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const existing = await clientAccountService.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Cuenta no encontrada.' });
    if (existing.password_hash) {
      return res.status(400).json({ error: 'Esta cuenta ya está activada — usa "Mandar link de restablecer" si perdió su contraseña.' });
    }

    const account = await clientAccountService.regenerateInvite(existing.email);
    const activationUrl = `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/portal/activar?token=${account.activation_token}`;
    const result = await emailService.sendClientPortalInviteEmail(account.email, { name: account.name, activationUrl });

    res.json({ account: toClientAccountSummary(account), emailSent: Boolean(result?.success), error: result?.success ? undefined : result?.error });
  } catch (error) {
    console.error('❌ Error al reenviar la invitación del portal:', error);
    res.status(400).json({ error: error.message || 'No se pudo reenviar la invitación.' });
  }
});

app.post('/api/client-accounts/:id/restablecer-password', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const existing = await clientAccountService.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Cuenta no encontrada.' });

    const result = await clientAccountService.requestPasswordReset(existing.email);
    const resetUrl = `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/portal/restablecer?token=${result.resetToken}`;
    const emailResult = await emailService.sendClientPortalResetEmail(result.account.email, { name: result.account.name, resetUrl });

    res.json({ emailSent: Boolean(emailResult?.success), error: emailResult?.success ? undefined : emailResult?.error });
  } catch (error) {
    console.error('❌ Error al mandar el restablecimiento del portal:', error);
    res.status(400).json({ error: error.message || 'No se pudo mandar el link de restablecimiento.' });
  }
});

app.delete('/api/client-accounts/:id', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    await clientAccountService.deleteAccount(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar la cuenta del portal:', error);
    res.status(500).json({ error: 'Error al eliminar la cuenta del portal.', details: error.message });
  }
});

// Servir frontend en producción si existe dist/
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'), err => {
    if (err) next();
  });
});

/**
 * Aviso al arrancar si el despliegue trae codigo nuevo pero la base de datos se
 * quedo atras: una tabla o columna que el codigo espera y no existe hace que la
 * pantalla que la usa falle, y una tabla que no se puede leer es indistinguible
 * de una tabla sin datos.
 */
async function warnAboutPendingMigrations() {
  try {
    const [, pending] = await db.migrate.list();
    if (pending.length === 0) return;
    console.warn(`
[!] Hay ${pending.length} migracion(es) SIN APLICAR en esta base de datos.`);
    console.warn('    Las pantallas que dependan de ellas fallaran (pueden verse vacias).');
    console.warn('    Ejecuta:  npm run migrate');
    for (const m of pending) console.warn(`    - ${m.file || m}`);
    console.warn('');
  } catch (error) {
    console.error('No se pudo comprobar el estado de las migraciones:', error.message);
  }
}

app.listen(PORT, () => {
  console.log(`\n🚀 Servidor de Evaluación de Tesis corriendo en http://localhost:${PORT}`);
  console.log(`- API Status: http://localhost:${PORT}/api/health`);

  warnAboutPendingMigrations();

  if (process.env.META_PAGE_ACCESS_TOKEN) {
    pageFollowerService.pollAndStore().catch((error) => {
      console.error('❌ [Meta Followers] Error en el sondeo inicial de seguidores:', error);
    });
    setInterval(() => {
      pageFollowerService.pollAndStore().catch((error) => {
        console.error('❌ [Meta Followers] Error en el sondeo periódico de seguidores:', error);
      });
    }, FOLLOWER_POLL_INTERVAL_MS);
  }

  setInterval(() => {
    whatsappBotService.checkStaleConversations().catch((error) => {
      console.error('❌ [WhatsApp Bot] Error en el barrido de conversaciones inactivas:', error);
    });
    // Mismo intervalo: el recordatorio se manda cuando faltan menos de 45
    // minutos para la reunión, así que basta con revisar cada diez minutos.
    whatsappBotService.sendMeetingReminders().catch((error) => {
      console.error('❌ [WhatsApp Bot] Error en el barrido de recordatorios de reuniones:', error);
    });
    // La agenda diaria del vendedor se cuelga del mismo barrido en vez de
    // tener su propio temporizador: el método decide solo si ya es su hora
    // (8 a.m. de Lima) y si no se mandó ya la de hoy, así que revisarlo cada
    // diez minutos alcanza y el aviso sale entre las 8:00 y las 8:10.
    whatsappBotService.sendDailyAgendaToSalesperson().catch((error) => {
      console.error('❌ [WhatsApp Bot] Error al mandar la agenda diaria al vendedor:', error);
    });
  }, STALE_CONVERSATION_SWEEP_INTERVAL_MS);
});
