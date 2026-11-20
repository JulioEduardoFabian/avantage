import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_config.dart';
import '../models/app_notification.dart';
import '../push/push_gateway.dart';
import '../state/app_state.dart';
import 'diagnostics_page.dart';
import 'notification_meta.dart';
import 'theme.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key, required this.state});
  final AppState state;

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  @override
  void initState() {
    super.initState();
    widget.state.addListener(_onPendingLink);
  }

  @override
  void dispose() {
    widget.state.removeListener(_onPendingLink);
    super.dispose();
  }

  /// Alguien tocó un aviso: el `link` que trae es una ruta del panel web
  /// (`/admin/calendario`). La app no tiene esas pantallas —reimplementar el
  /// CRM entero no es de lo que se trata esto— así que ofrece abrirla en el
  /// navegador, que es lo que la persona iba a hacer igual.
  void _onPendingLink() {
    final link = widget.state.pendingLink;
    if (link == null || !mounted) return;
    widget.state.consumePendingLink();
    _openInPanel(link);
  }

  Future<void> _openInPanel(String link) async {
    final uri = Uri.parse(link.startsWith('http') ? link : '${AppConfig.apiBaseUrl}$link');
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo abrir $uri')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Avisos'),
            Text(
              state.unread == 0 ? 'Todo leído' : '${state.unread} sin leer',
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w400, color: scheme.onSurface.withValues(alpha: 0.6)),
            ),
          ],
        ),
        actions: [
          if (state.unread > 0)
            IconButton(
              tooltip: 'Marcar todo como leído',
              onPressed: state.markAllRead,
              icon: const Icon(Icons.done_all),
            ),
          IconButton(
            tooltip: 'Estado del push',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => DiagnosticsPage(state: state)),
            ),
            icon: Icon(
              state.pushState.isPush ? Icons.cloud_done_outlined : Icons.cloud_sync_outlined,
              color: state.pushState.isPush ? Brand.emerald : Brand.terracotta,
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await state.refreshNotifications();
          // Tirar hacia abajo también fuerza una vuelta del sondeo: en Windows
          // y Linux es la única forma de pedir los avisos ahora mismo.
          if (!state.pushState.isPush) await state.push.pollOnce();
        },
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _TransportBanner(state: state)),
            if (state.items.isEmpty)
              SliverFillRemaining(hasScrollBody: false, child: _Empty(state: state))
            else
              SliverList.separated(
                itemCount: state.items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (_, index) {
                  final item = state.items[index];
                  return Padding(
                    padding: EdgeInsets.fromLTRB(14, index == 0 ? 4 : 0, 14, index == state.items.length - 1 ? 24 : 0),
                    child: _NotificationCard(
                      item: item,
                      onTap: () {
                        state.markRead(item);
                        if (item.link != null) _openInPanel(item.link!);
                      },
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}

/// La banda que dice por dónde están llegando los avisos.
///
/// Sale **solo cuando no es push de verdad**: con el push andando no hay nada
/// que explicar, y una banda permanente se vuelve parte del fondo y deja de
/// leerse justo el día que dice algo importante.
class _TransportBanner extends StatelessWidget {
  const _TransportBanner({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final push = state.pushState;
    if (push.isPush && push.permissionGranted && push.reason == null) return const SizedBox.shrink();

    final (icon, color, text) = switch (push) {
      PushState(permissionGranted: false) => (
        Icons.notifications_off_outlined,
        Brand.terracotta,
        'No diste permiso de notificaciones: los avisos se ven acá adentro pero no en la pantalla. '
            'Se habilita desde los ajustes del sistema.',
      ),
      PushState(transport: PushTransport.polling, reason: final reason?) => (
        Icons.cloud_sync_outlined,
        Brand.olive,
        reason,
      ),
      PushState(reason: final reason?) => (Icons.info_outline, Brand.terracotta, reason),
      _ => (Icons.cloud_sync_outlined, Brand.olive, 'Los avisos llegan mientras la app esté abierta.'),
    };

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 14),
      child: Material(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => DiagnosticsPage(state: state)),
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: color.withValues(alpha: 0.3)),
            ),
            child: Row(
              children: [
                Icon(icon, color: color, size: 20),
                const SizedBox(width: 10),
                Expanded(child: Text(text, style: TextStyle(fontSize: 12.8, color: color, height: 1.35))),
                Icon(Icons.chevron_right, color: color.withValues(alpha: 0.7), size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.item, required this.onTap});
  final AppNotification item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final meta = NotificationMeta.of(item.type);
    final scheme = Theme.of(context).colorScheme;

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                height: 38,
                width: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: meta.color.withValues(alpha: 0.13),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(meta.icon, size: 20, color: meta.color),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            meta.label.toUpperCase(),
                            style: TextStyle(
                              fontSize: 10.5,
                              letterSpacing: 0.6,
                              fontWeight: FontWeight.w700,
                              color: meta.color,
                            ),
                          ),
                        ),
                        Text(
                          relativeTime(item.createdAt),
                          style: TextStyle(fontSize: 11.5, color: scheme.onSurface.withValues(alpha: 0.5)),
                        ),
                        // El punto de "sin leer" va al final del renglón de
                        // arriba y no sobre el título: el título es lo que
                        // identifica el aviso, y es lo último que se recorta.
                        if (!item.isRead) ...[
                          const SizedBox(width: 8),
                          Container(
                            height: 8,
                            width: 8,
                            decoration: const BoxDecoration(color: Brand.terracotta, shape: BoxShape.circle),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      item.title,
                      style: TextStyle(
                        fontSize: 15,
                        height: 1.3,
                        fontWeight: item.isRead ? FontWeight.w500 : FontWeight.w700,
                      ),
                    ),
                    if (item.body != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        item.body!,
                        style: TextStyle(fontSize: 13.2, height: 1.35, color: scheme.onSurface.withValues(alpha: 0.72)),
                      ),
                    ],
                    if (item.link != null) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Icon(Icons.open_in_new, size: 14, color: scheme.primary),
                          const SizedBox(width: 5),
                          Text(
                            'Abrir en el panel',
                            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: scheme.primary),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 48),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.notifications_none, size: 56, color: scheme.onSurface.withValues(alpha: 0.25)),
          const SizedBox(height: 14),
          Text(
            state.error == null ? 'Todavía no hay avisos' : 'No se pudieron traer los avisos',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            state.error ??
                'Acá van a aparecer las reuniones que agende Avan, los pagos verificados y '
                    'los proyectos nuevos. Tirá hacia abajo para volver a mirar.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13.3, height: 1.4, color: scheme.onSurface.withValues(alpha: 0.6)),
          ),
        ],
      ),
    );
  }
}
