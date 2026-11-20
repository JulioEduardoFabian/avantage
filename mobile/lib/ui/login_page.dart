import 'package:flutter/material.dart';

import '../app_config.dart';
import '../state/app_state.dart';
import 'theme.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.state});
  final AppState state;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _obscure = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    await widget.state.signIn(email: _email.text, password: _password.text);
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              // En escritorio un formulario de ancho completo pone el campo de
              // correo a 1400 px: se acota como en el panel.
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      height: 64,
                      width: 64,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: scheme.primary,
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: const Icon(Icons.notifications_active_outlined, color: Colors.white, size: 32),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      'Avisos Avantage',
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Las notificaciones del panel, en tu dispositivo.',
                      style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.65)),
                    ),
                    const SizedBox(height: 28),

                    if (state.sessionExpired)
                      _Banner(
                        icon: Icons.schedule_outlined,
                        color: Brand.terracotta,
                        // Sin esto, volver al login parece que la app se
                        // deslogueó sola: el token del panel dura 8 h.
                        text: 'Tu sesión expiró. Volvé a entrar.',
                      ),

                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Correo',
                        prefixIcon: Icon(Icons.alternate_email),
                      ),
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Escribí tu correo.' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        labelText: 'Contraseña',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _obscure = !_obscure),
                          icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          tooltip: _obscure ? 'Mostrar' : 'Ocultar',
                        ),
                      ),
                      validator: (v) => (v == null || v.isEmpty) ? 'Escribí tu contraseña.' : null,
                    ),

                    if (state.error != null) ...[
                      const SizedBox(height: 16),
                      _Banner(icon: Icons.error_outline, color: Brand.terracotta, text: state.error!),
                    ],

                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: state.busy ? null : _submit,
                      child: state.busy
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                            )
                          : const Text('Entrar'),
                    ),
                    const SizedBox(height: 18),
                    // La URL va a la vista y no escondida: el fallo más común
                    // al probar la app es apuntar al servidor equivocado, y sin
                    // verla el error de red no dice contra qué falló.
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.dns_outlined, size: 15, color: scheme.onSurface.withValues(alpha: 0.5)),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            AppConfig.apiBaseUrl,
                            style: TextStyle(fontSize: 12, color: scheme.onSurface.withValues(alpha: 0.5)),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.color, required this.text});
  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withValues(alpha: 0.35)),
    ),
    child: Row(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: TextStyle(color: color, fontSize: 13.5))),
      ],
    ),
  );
}
