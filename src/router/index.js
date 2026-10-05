import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import LeadsView from '../views/LeadsView.vue';
import DatabaseView from '../views/DatabaseView.vue';
import ProjectsView from '../views/ProjectsView.vue';
import ProjectDetailView from '../views/ProjectDetailView.vue';
import DeliverablesView from '../views/DeliverablesView.vue';
import RolesView from '../views/RolesView.vue';
import CareersView from '../views/CareersView.vue';
import MetaWebhookTestView from '../views/MetaWebhookTestView.vue';
import SocialInteractionsView from '../views/SocialInteractionsView.vue';
import WhatsAppView from '../views/WhatsAppView.vue';
import AvailabilityView from '../views/AvailabilityView.vue';
import BotScriptView from '../views/BotScriptView.vue';
import SetterFunnelView from '../views/SetterFunnelView.vue';
import InstagramInteractionsView from '../views/InstagramInteractionsView.vue';
import CampaignsView from '../views/CampaignsView.vue';
import FinanceView from '../views/FinanceView.vue';
import CollectionsView from '../views/CollectionsView.vue';
import CalendarView from '../views/CalendarView.vue';
import ContractsView from '../views/ContractsView.vue';
import DocumentsView from '../views/DocumentsView.vue';
import PortalLoginView from '../views/portal/PortalLoginView.vue';
import PortalActivateView from '../views/portal/PortalActivateView.vue';
import PortalForgotPasswordView from '../views/portal/PortalForgotPasswordView.vue';
import PortalResetPasswordView from '../views/portal/PortalResetPasswordView.vue';
import PortalProjectsView from '../views/portal/PortalProjectsView.vue';
import PortalProjectDetailView from '../views/portal/PortalProjectDetailView.vue';
import PortalProfileView from '../views/portal/PortalProfileView.vue';
import { isAuthenticated, hasPermission } from '../auth.js';
import { isClientAuthenticated } from '../clientAuth.js';
import { refreshSessionOnce } from '../apiClient.js';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Sistema interno: la puerta de entrada es el login, no el evaluador
    // público. El evaluador sigue existiendo, solo que ya no es la portada.
    { path: '/', redirect: () => (isAuthenticated() ? { name: 'dashboard' } : { name: 'login' }) },
    { path: '/evaluador-tesis', name: 'home', component: HomeView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { requiresAuth: true } },
    { path: '/admin/database', name: 'database', component: DatabaseView, meta: { requiresAuth: true, permission: 'database.view' } },
    { path: '/admin/leads', name: 'leads', component: LeadsView, meta: { requiresAuth: true, permission: 'leads.view' } },
    { path: '/admin/setter-funnel', name: 'setter-funnel', component: SetterFunnelView, meta: { requiresAuth: true, permission: 'setter.view' } },
    { path: '/admin/projects', name: 'projects', component: ProjectsView, meta: { requiresAuth: true, permission: 'projects.view' } },
    { path: '/admin/projects/:id', name: 'project-detail', component: ProjectDetailView, props: true, meta: { requiresAuth: true, permission: 'projects.view' } },
    { path: '/admin/entregables', name: 'deliverables', component: DeliverablesView, meta: { requiresAuth: true, permission: 'deliverables.view' } },
    { path: '/admin/roles', name: 'roles', component: RolesView, meta: { requiresAuth: true, permission: 'roles.manage' } },
    { path: '/admin/carreras', name: 'careers', component: CareersView, meta: { requiresAuth: true, permission: 'careers.manage' } },
    { path: '/admin/webhooks', name: 'webhooks', component: MetaWebhookTestView, meta: { requiresAuth: true, permission: 'webhooks.view' } },
    { path: '/admin/social', name: 'social', component: SocialInteractionsView, meta: { requiresAuth: true, permission: 'social.view' } },
    { path: '/admin/instagram', name: 'instagram', component: InstagramInteractionsView, meta: { requiresAuth: true, permission: 'instagram.view' } },
    { path: '/admin/campaigns', name: 'campaigns', component: CampaignsView, meta: { requiresAuth: true, permission: 'campaigns.view' } },
    { path: '/admin/calendario', name: 'calendar', component: CalendarView, meta: { requiresAuth: true, permission: 'calendar.view' } },
    { path: '/admin/cobranzas', name: 'collections', component: CollectionsView, meta: { requiresAuth: true, permission: 'collections.view' } },
    { path: '/admin/finance', name: 'finance', component: FinanceView, meta: { requiresAuth: true, permission: 'finance.view' } },
    { path: '/admin/contracts', name: 'contracts', component: ContractsView, meta: { requiresAuth: true, permission: 'contracts.manage' } },
    { path: '/admin/documents', name: 'documents', component: DocumentsView, meta: { requiresAuth: true, permission: 'documents.view' } },
    { path: '/admin/whatsapp', name: 'whatsapp', component: WhatsAppView, meta: { requiresAuth: true, permission: 'whatsapp.view' } },
    { path: '/admin/availability', name: 'availability', component: AvailabilityView, meta: { requiresAuth: true, permission: 'availability.view' } },
    { path: '/admin/bot-script', name: 'bot-script', component: BotScriptView, meta: { requiresAuth: true, permission: 'bot.manage' } },

    // Portal de clientes: login independiente del panel interno (ver clientAuth.js).
    { path: '/portal/login', name: 'portal-login', component: PortalLoginView },
    { path: '/portal/activar', name: 'portal-activate', component: PortalActivateView },
    { path: '/portal/olvide-password', name: 'portal-forgot', component: PortalForgotPasswordView },
    { path: '/portal/restablecer', name: 'portal-reset', component: PortalResetPasswordView },
    { path: '/portal', name: 'portal-home', component: PortalProjectsView, meta: { requiresClientAuth: true } },
    { path: '/portal/perfil', name: 'portal-profile', component: PortalProfileView, meta: { requiresClientAuth: true } },
    { path: '/portal/proyectos/:id', name: 'portal-project', component: PortalProjectDetailView, props: true, meta: { requiresClientAuth: true } }
  ]
});

router.beforeEach(async (to) => {
  if (to.meta.requiresClientAuth && !isClientAuthenticated()) {
    return { name: 'portal-login', query: { redirect: to.fullPath } };
  }

  if (!to.meta.requiresAuth) return true;

  if (!isAuthenticated()) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  // Permisos al día (y token reemitido si cambiaron) antes de evaluar el
  // permiso de la ruta y de que la vista llame a la API.
  await refreshSessionOnce();
  if (!isAuthenticated()) return { name: 'login', query: { redirect: to.fullPath } };

  if (to.meta.permission && !hasPermission(to.meta.permission)) {
    return { name: 'dashboard' };
  }

  return true;
});

export default router;
