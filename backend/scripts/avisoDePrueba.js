import 'dotenv/config';
import { db } from '../db/connection.js';
import { NotificationService } from '../services/notificationService.js';
import { DeviceTokenService } from '../services/deviceTokenService.js';
import { PushService } from '../services/pushService.js';

/**
 * Crea un aviso de prueba en la campana del panel, por el MISMO camino por el
 * que lo crean el bot, Finanzas y los proyectos.
 *
 * Existe porque probar la app de notificaciones, si no, obliga a esperar a que
 * alguien agende una reunión o a que Finanzas verifique un pago. Pasa por
 * `notificationService.create()` a propósito y no por un `insert` directo: ese
 * es el punto del que cuelga el push, así que un `insert` a mano probaría la
 * campana y **no** la mitad que se vino a probar.
 *
 * Es distinto de `POST /api/push/test`: aquel manda un push suelto a los
 * dispositivos de quien lo pide y no deja fila, para comprobar la cadena de
 * Firebase. Esto crea un aviso de verdad, que es lo que también encuentra el
 * sondeo — o sea, lo único que sirve para probar Windows, Linux y cualquier
 * instalación sin Firebase.
 *
 * Uso:
 *   node backend/scripts/avisoDePrueba.js
 *   node backend/scripts/avisoDePrueba.js "Título" "Cuerpo del aviso"
 */

const [, , tituloArg, cuerpoArg] = process.argv;

const hora = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });

const deviceTokenService = new DeviceTokenService();
const pushService = new PushService({ deviceTokenService });
const notificationService = new NotificationService({ pushService });

const estado = pushService.status();
console.log('');
console.log('  Push en el servidor:', estado.configured
  ? `configurado (proyecto ${estado.projectId})`
  : 'APAGADO — faltan las FCM_* del .env, así que la app solo lo verá por sondeo');
if (estado.error) console.log('  Motivo:', estado.error);

const dispositivos = await deviceTokenService.counts();
if (dispositivos.length === 0) {
  console.log('  Dispositivos registrados: ninguno (abrí la app e iniciá sesión al menos una vez)');
} else {
  for (const fila of dispositivos) {
    console.log(`  Dispositivos: ${fila.total} × ${fila.platform} (${fila.transport === 'fcm' ? 'push' : 'sondeo'})`);
  }
}

const notificacion = await notificationService.create({
  type: 'push_test',
  title: tituloArg || 'Aviso de prueba',
  body: cuerpoArg || `Creado desde el script a las ${hora}. Si lo ves en tu dispositivo, la cadena funciona.`,
  link: '/admin/dashboard'
});

console.log('');
console.log(`  Aviso #${notificacion.id} creado en la campana del panel.`);
console.log(estado.configured
  ? '  El push salió en paralelo: debería llegar en segundos.'
  : '  Sin Firebase, la app lo va a encontrar en su próximo sondeo (hasta 45 s, o tirá la lista hacia abajo).');
console.log('');

// El push se lanza sin esperarlo (es la regla del servicio), así que se le da
// un momento antes de cerrar la conexión: si no, el proceso termina con la
// llamada a Firebase a medio camino y el envío se pierde sin decir nada.
await new Promise((resolve) => setTimeout(resolve, estado.configured ? 4000 : 0));
await db.destroy();
