import 'package:flutter/material.dart';

import 'state/app_state.dart';
import 'ui/login_page.dart';
import 'ui/notifications_page.dart';
import 'ui/theme.dart';

void main() {
  runApp(const AvantageApp());
}

class AvantageApp extends StatefulWidget {
  const AvantageApp({super.key});

  @override
  State<AvantageApp> createState() => _AvantageAppState();
}

class _AvantageAppState extends State<AvantageApp> with WidgetsBindingObserver {
  final AppState _state = AppState();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _state.restore();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _state.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    // Al volver a la app se refresca: mientras estuvo en segundo plano pudo
    // haber llegado un push (que el sistema mostró en la barra pero la lista no
    // vio) o alguien pudo haber leído los avisos desde el panel web.
    if (lifecycle == AppLifecycleState.resumed && _state.isSignedIn) {
      _state.refreshNotifications();
      if (!_state.pushState.isPush) _state.push.pollOnce();
    }
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Avisos Avantage',
    debugShowCheckedModeBanner: false,
    theme: buildLightTheme(),
    darkTheme: buildDarkTheme(),
    // Sigue el tema del sistema: un panel que se usa de noche en el celular y
    // de día en el escritorio no tiene un solo modo correcto.
    themeMode: ThemeMode.system,
    home: AnimatedBuilder(
      animation: _state,
      builder: (context, _) {
        if (_state.restoring) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        return _state.isSignedIn ? NotificationsPage(state: _state) : LoginPage(state: _state);
      },
    ),
  );
}
