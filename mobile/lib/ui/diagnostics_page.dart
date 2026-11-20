import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app_config.dart';
import '../push/push_gateway.dart';
import '../state/app_state.dart';
import 'theme.dart';

/// Por qué (no) llegan los avisos.
///
/// Es la pantalla que de verdad importa en una app de notificaciones: "no me
/// llega nada" tiene al menos cinco causas —el permiso del sistema, las
/// credenciales de la app, las del servidor, la plataforma sin FCM, o que
/// simplemente no pasó nada— y se arreglan en cinco lugares distintos. Sin
/// esto, las cinco se ven igual: una lista vacía.
class DiagnosticsPage extends StatefulWidget {
  const DiagnosticsPage({super.key, required this.state});
  final AppState state;

  @override
  State<DiagnosticsPage> createState() => _DiagnosticsPageState();
}

class _DiagnosticsPageState extends State<DiagnosticsPage> {
  bool _sending = false;
  List<Map<String, dynamic>>? _devices;

  @override
  void initState() {
    super.initState();
    _loadDevices();
  }

  Future<void> _loadDevices() async {
    try {
      final devices = await widget.state.devices.listMine();
      if (mounted) setState(() => _devices = devices);
    } catch (_) {
      if (mounted) setState(() => _devices = const []);
    }
  }

  Future<void> _sendTest() async {
    setState(() => _sending = true);
    final message = await widget.state.sendTestPush();
    if (!mounted) return;
    setState(() => _sending = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final push = state.pushState;
    final session = state.session;

    return Scaffold(
      appBar: AppBar(title: const Text('Estado de los avisos')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 32),
        children: [
          _Section(
            title: 'Cómo llegan',
            children: [
              _Row(
                label: 'Camino',
                value: push.isPush ? 'Push de Firebase' : 'Sondeo cada ${AppConfig.pollInterval.inSeconds} s',
                good: push.isPush,
                // La diferencia que importa: el push llega con la app cerrada y
                // el sondeo no. Decirlo acá evita la conclusión equivocada de
                // que la app "está rota" cuando en realidad está apagada.
                note: push.isPush
                    ? 'Llega aunque la app esté cerrada.'
                    : 'Solo llega mientras la app esté abierta.',
              ),
              _Row(
                label: 'Permiso del sistema',
                value: push.permissionGranted ? 'Concedido' : 'Denegado',
                good: push.permissionGranted,
                note: push.permissionGranted
                    ? null
                    : 'Sin este permiso el aviso no se dibuja en la pantalla. Se concede desde los '
                        'ajustes del sistema, no desde la app.',
              ),
              _Row(
                label: 'Credenciales en el servidor',
                value: switch (push.serverConfigured) {
                  true => 'Configuradas',
                  false => 'Faltan',
                  null => 'No se pudo consultar',
                },
                good: push.serverConfigured == true,
                note: push.serverConfigured == false
                    ? 'El backend no tiene las FCM_* en su .env: no va a empujar nada.'
                    : null,
              ),
              if (push.reason != null) _Note(push.reason!),
            ],
          ),

          const SizedBox(height: 16),
          _Section(
            title: 'Este dispositivo',
            children: [
              _Row(label: 'Servidor', value: AppConfig.apiBaseUrl),
              _Row(label: 'Cuenta', value: session == null ? '—' : '${session.name} · ${session.role}'),
              _Row(
                label: push.transport == PushTransport.fcm ? 'Token de Firebase' : 'Id de sondeo',
                value: _shorten(push.token),
                // El token completo se copia pero no se muestra entero: es la
                // dirección de envío de este aparato y ocupa 160 caracteres que
                // no dicen nada a la vista.
                trailing: push.token == null
                    ? null
                    : IconButton(
                        tooltip: 'Copiar',
                        icon: const Icon(Icons.copy_outlined, size: 18),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: push.token!));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Token copiado')),
                          );
                        },
                      ),
              ),
            ],
          ),

          const SizedBox(height: 16),
          _Section(
            title: 'Dispositivos de tu cuenta',
            children: [
              if (_devices == null)
                const Padding(
                  padding: EdgeInsets.all(14),
                  child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
                )
              else if (_devices!.isEmpty)
                const _Note('Ninguno registrado todavía.')
              else
                ..._devices!.map(
                  (device) => _Row(
                    label: (device['device_label'] ?? device['platform'] ?? '—').toString(),
                    value: [
                      device['platform']?.toString() ?? '',
                      device['transport'] == 'fcm' ? 'push' : 'sondeo',
                      if (device['revoked_at'] != null) 'dado de baja',
                    ].where((p) => p.isNotEmpty).join(' · '),
                    good: device['revoked_at'] == null && device['transport'] == 'fcm',
                  ),
                ),
            ],
          ),

          const SizedBox(height: 22),
          FilledButton.icon(
            onPressed: _sending ? null : _sendTest,
            icon: _sending
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                  )
                : const Icon(Icons.send_outlined),
            label: const Text('Enviarme una notificación de prueba'),
          ),
          const SizedBox(height: 10),
          Text(
            'La prueba va solo a tus dispositivos y no deja nada en la campana del panel: '
            'comprueba la cadena completa (servidor → Firebase → este aparato) sin esperar '
            'a que alguien agende una reunión.',
            style: TextStyle(fontSize: 12.4, height: 1.4, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6)),
          ),

          const SizedBox(height: 22),
          OutlinedButton.icon(
            onPressed: () async {
              await widget.state.retryPush();
              await _loadDevices();
              if (mounted) setState(() {});
            },
            icon: const Icon(Icons.refresh),
            label: const Text('Volver a intentar el push'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: Brand.terracotta),
            onPressed: () async {
              await widget.state.signOut();
              if (context.mounted) Navigator.of(context).pop();
            },
            icon: const Icon(Icons.logout),
            label: const Text('Cerrar sesión'),
          ),
        ],
      ),
    );
  }

  static String _shorten(String? token) {
    if (token == null || token.isEmpty) return '—';
    if (token.length <= 22) return token;
    return '${token.substring(0, 12)}…${token.substring(token.length - 8)}';
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(left: 4, bottom: 8),
        child: Text(
          title.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            letterSpacing: 0.7,
            fontWeight: FontWeight.w700,
            color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
          ),
        ),
      ),
      Card(child: Column(children: children)),
    ],
  );
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value, this.good, this.note, this.trailing});
  final String label;
  final String value;
  final bool? good;
  final String? note;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (good != null) ...[
                Icon(
                  good! ? Icons.check_circle : Icons.error_outline,
                  size: 17,
                  color: good! ? Brand.emerald : Brand.terracotta,
                ),
                const SizedBox(width: 8),
              ],
              Expanded(child: Text(label, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600))),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  value,
                  textAlign: TextAlign.right,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface.withValues(alpha: 0.72)),
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          if (note != null)
            Padding(
              padding: EdgeInsets.only(left: good == null ? 0 : 25, top: 4),
              child: Text(
                note!,
                style: TextStyle(fontSize: 12.2, height: 1.35, color: scheme.onSurface.withValues(alpha: 0.6)),
              ),
            ),
        ],
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(14, 2, 14, 12),
    child: Text(
      text,
      style: TextStyle(fontSize: 12.4, height: 1.4, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65)),
    ),
  );
}
