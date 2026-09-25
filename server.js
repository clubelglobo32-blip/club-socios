require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const libre = require('libreoffice-convert');
const util = require('util');
const libreConvert = util.promisify(libre.convert);
const { createClient } = require('@supabase/supabase-js');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function formatearFechaLarga(fechaStr) {
    if (!fechaStr) return '';
    const partes = String(fechaStr).split('T')[0].split('-');
    if (partes.length !== 3) return fechaStr;
    const [anio, mes, dia] = partes;
    const mesNombre = MESES[parseInt(mes, 10) - 1];
    if (!mesNombre) return fechaStr;
    return `${parseInt(dia, 10)} de ${mesNombre} de ${anio}`;
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- Conexión a Postgres (Supabase) ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- Cliente de Supabase Storage (para logo, plantilla, comprobantes y firmas) ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = process.env.SUPABASE_BUCKET || 'club-archivos';

async function subirArchivo(file, carpeta) {
    if (!file) return null;
    const nombreLimpio = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const rutaEnBucket = `${carpeta}/${Date.now()}_${nombreLimpio}`;

    const { error } = await supabase.storage.from(BUCKET).upload(rutaEnBucket, file.buffer, {
        contentType: file.mimetype,
        upsert: false
    });
    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(rutaEnBucket);
    return data.publicUrl;
}

// Descarga un archivo público (por ejemplo la plantilla Word) para procesarlo en memoria
async function descargarArchivoComoBuffer(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`No se pudo descargar el archivo (HTTP ${resp.status}): ${url}`);
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    store: new pgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'cambia_este_secreto_en_produccion',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas
}));

app.use(express.static(path.join(__dirname, 'public')));

// Los archivos ahora se reciben en memoria y se suben a Supabase Storage (no al disco local)
const upload = multer({ storage: multer.memoryStorage() });

// El rol "espectador" solo puede consultar información (GET). Cualquier intento
// de crear, modificar o borrar datos queda bloqueado acá, sin importar la pantalla.
function bloquearEspectador(req, res, next) {
    if (req.session.rol === 'espectador') {
        return res.status(403).json({ error: 'Tu usuario es Espectador (solo lectura) y no puede realizar esta acción.' });
    }
    next();
}

// --- API: SESIÓN ---
app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user, nombre: req.session.nombre, rol: req.session.rol });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/login', async (req, res) => {
    const { usuario, password } = req.body;
    try {
        const { rows } = await pool.query(`SELECT * FROM usuarios WHERE usuario = $1 AND password = $2`, [usuario, password]);
        const row = rows[0];
        if (row) {
            req.session.user = row.usuario;
            req.session.nombre = row.nombre_completo;
            req.session.rol = row.rol;
            res.json({ success: true, rol: row.rol });
        } else {
            res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// --- API: AJUSTES ---
app.get('/api/ajustes', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM ajustes WHERE id = 1`);
        res.json(rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ajustes', upload.fields([{ name: 'logo_file', maxCount: 1 }, { name: 'plantilla_word_file', maxCount: 1 }]), async (req, res) => {
    if (req.session.rol !== 'admin') return res.status(403).json({ error: 'Acceso denegado. Solo el administrador puede modificar ajustes.' });

    const {
        nombre_club, email_contacto, telefono_contacto, proximo_legajo,
        precio_sintetico_f5, precio_futsal, precio_pasto_f11,
        cant_sintetico_f5, cant_futsal, cant_pasto_f11,
        inscripcion_socio, cuota_jugador, cuota_transitorio, cuota_pleno
    } = req.body;

    try {
        const { rows } = await pool.query(`SELECT logo_url, plantilla_word FROM ajustes WHERE id = 1`);
        const current = rows[0];

        let logo_url = current ? current.logo_url : '';
        if (req.files && req.files['logo_file']) {
            logo_url = await subirArchivo(req.files['logo_file'][0], 'logos');
        } else if (req.body.logo_url) {
            logo_url = req.body.logo_url;
        }

        let plantilla_word = current ? current.plantilla_word : '';
        if (req.files && req.files['plantilla_word_file']) {
            plantilla_word = await subirArchivo(req.files['plantilla_word_file'][0], 'plantillas');
        }

        await pool.query(
            `UPDATE ajustes SET
                nombre_club = $1, logo_url = $2, plantilla_word = $3, email_contacto = $4, telefono_contacto = $5, proximo_legajo = $6,
                precio_sintetico_f5 = $7, precio_futsal = $8, precio_pasto_f11 = $9,
                cant_sintetico_f5 = $10, cant_futsal = $11, cant_pasto_f11 = $12,
                inscripcion_socio = $13, cuota_jugador = $14, cuota_transitorio = $15, cuota_pleno = $16
             WHERE id = 1`,
            [
                nombre_club, logo_url, plantilla_word, email_contacto, telefono_contacto, proximo_legajo,
                precio_sintetico_f5, precio_futsal, precio_pasto_f11,
                cant_sintetico_f5, cant_futsal, cant_pasto_f11,
                inscripcion_socio, cuota_jugador, cuota_transitorio, cuota_pleno
            ]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: OBTENER PAGOS DE UN SOCIO ---
app.get('/api/socios/:id/pagos', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM pagos_socios WHERE socio_id = $1`, [req.params.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: REGISTRAR COBRO DE CUOTA DE UN SOCIO (Y VOLCARLO EN CAJA) ---
app.post('/api/socios/pagar', bloquearEspectador, upload.single('comprobante'), async (req, res) => {
    const { socio_id, socio_nombre, concepto, detalle, monto } = req.body;
    if (!socio_id || !monto) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (socio y monto).' });
    }

    try {
        const comprobante = req.file ? await subirArchivo(req.file, 'comprobantes') : null;
        const fechaHoy = new Date().toISOString().split('T')[0];
        const horaActual = new Date().toTimeString().split(' ')[0];

        const insertPago = await pool.query(
            `INSERT INTO pagos_socios (socio_id, concepto, detalle, monto, comprobante) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [socio_id, concepto || 'Cuota Social', detalle || '', monto, comprobante]
        );

        const descripcionCaja = `${concepto || 'Cuota Social'} - ${socio_nombre || 'Socio'} (${detalle || ''})`;
        await pool.query(
            `INSERT INTO caja (fecha, hora, tipo, descripcion, monto) VALUES ($1, $2, 'Ingreso', $3, $4)`,
            [fechaHoy, horaActual, descripcionCaja, monto]
        );

        res.json({
            success: true,
            id: insertPago.rows[0].id,
            fecha: fechaHoy,
            hora: horaActual,
            detalle: detalle || '',
            monto
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: SOCIOS ---
app.get('/api/socios', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM socios ORDER BY apellido ASC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/socios', bloquearEspectador, async (req, res) => {
    const { nombre, apellido, dni, fecha_nacimiento, fecha_alta, direccion, telefono, email, nacionalidad, estado_civil, categoria } = req.body;

    const fechaRealAlta = (req.session.rol === 'operador' || !fecha_alta) ? new Date().toISOString().split('T')[0] : fecha_alta;
    const usuarioCreador = req.session.nombre || req.session.user || 'Administrador';

    try {
        const { rows } = await pool.query(`SELECT proximo_legajo FROM ajustes WHERE id = 1`);
        const legajoAsignado = rows[0] ? rows[0].proximo_legajo : 120;

        const insertSocio = await pool.query(
            `INSERT INTO socios (legajo, nombre, apellido, dni, fecha_nacimiento, fecha_alta, direccion, telefono, email, nacionalidad, estado_civil, categoria, estado, creado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Al día', $13) RETURNING id`,
            [
                legajoAsignado,
                nombre || '',
                apellido || '',
                dni || '',
                fecha_nacimiento || '',
                fechaRealAlta,
                direccion || '',
                telefono || '',
                email || '',
                nacionalidad || 'Argentina',
                estado_civil || '',
                categoria || '',
                usuarioCreador
            ]
        );

        await pool.query(`UPDATE ajustes SET proximo_legajo = proximo_legajo + 1 WHERE id = 1`);
        res.json({ success: true, id: insertSocio.rows[0].id, legajo: legajoAsignado });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: SUBIR LEGAJO FIRMADO (PDF O IMAGEN) DE UN SOCIO ---
app.post('/api/socios/:id/firma', bloquearEspectador, upload.single('firma'), async (req, res) => {
    const { id } = req.params;
    if (!req.file) {
        return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    }
    try {
        const archivo_firma = await subirArchivo(req.file, 'firmas');
        await pool.query(`UPDATE socios SET archivo_firma = $1 WHERE id = $2`, [archivo_firma, id]);
        res.json({ success: true, archivo_firma });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: ELIMINAR SOCIO (SOLO ADMIN) ---
app.delete('/api/socios/:id', async (req, res) => {
    if (req.session.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo el administrador puede eliminar socios.' });
    }
    try {
        const { id } = req.params;
        await pool.query(`DELETE FROM pagos_socios WHERE socio_id = $1`, [id]);
        await pool.query(`DELETE FROM socios WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: GENERAR LEGAJO OFICIAL EN PDF USANDO LA PLANTILLA WORD (POR ID) ---
app.get('/api/socios/:id/legajo-pdf', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM socios WHERE id = $1`, [req.params.id]);
        const socio = rows[0];
        if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });

        const { rows: ajRows } = await pool.query(`SELECT plantilla_word FROM ajustes WHERE id = 1`);
        const ajuste = ajRows[0];
        if (!ajuste || !ajuste.plantilla_word) {
            return res.status(404).json({ error: 'El administrador no ha subido ninguna plantilla de Word en Ajustes.' });
        }

        const content = await descargarArchivoComoBuffer(ajuste.plantilla_word);
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

        const hoy = new Date();
        doc.render({
            legajo: socio.legajo || '',
            dia: hoy.getDate(),
            mes: MESES[hoy.getMonth()],
            anio: hoy.getFullYear(),
            categoria: socio.categoria || '',
            apellido: socio.apellido || '',
            nombre: socio.nombre || '',
            nacionalidad: socio.nacionalidad || '',
            estado_civil: socio.estado_civil || '',
            fecha_nacimiento: formatearFechaLarga(socio.fecha_nacimiento),
            dni: socio.dni || '',
            direccion: socio.direccion || '',
            email: socio.email || '',
            telefono: socio.telefono || ''
        });

        const bufWord = doc.getZip().generate({ type: 'nodebuffer' });
        const pdfBuf = await libreConvert(bufWord, '.pdf', undefined);

        res.setHeader('Content-Disposition', `attachment; filename=Legajo_${socio.apellido}_${socio.nombre}.pdf`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuf);
    } catch (error) {
        console.error('Error al procesar o convertir la plantilla a PDF:', error);
        res.status(500).json({ error: 'Error al generar el PDF del legajo. Verifique que LibreOffice esté instalado en el servidor.' });
    }
});

// --- API: GENERAR LEGAJO OFICIAL EN PDF DESDE EL FORMULARIO DE NUEVO SOCIO ---
app.post('/api/socios/generar-pdf', async (req, res) => {
    try {
        const socioData = req.body;

        const { rows } = await pool.query(`SELECT plantilla_word FROM ajustes WHERE id = 1`);
        const ajuste = rows[0];

        if (!ajuste || !ajuste.plantilla_word) {
            return res.status(404).json({ error: 'El administrador no ha subido ninguna plantilla de Word en Ajustes.' });
        }

        try {
            const content = await descargarArchivoComoBuffer(ajuste.plantilla_word);
            const zip = new PizZip(content);
            const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

            const hoy = new Date();
            doc.render({
                legajo: socioData.legajo || '',
                dia: hoy.getDate(),
                mes: MESES[hoy.getMonth()],
                anio: hoy.getFullYear(),
                categoria: socioData.categoria || '',
                apellido: socioData.apellido || '',
                nombre: socioData.nombre || '',
                nacionalidad: socioData.nacionalidad || 'Argentina',
                estado_civil: socioData.estado_civil || '',
                fecha_nacimiento: formatearFechaLarga(socioData.fecha_nacimiento),
                dni: socioData.dni || '',
                direccion: socioData.direccion || '',
                email: socioData.email || '',
                telefono: socioData.telefono || ''
            });

            const bufWord = doc.getZip().generate({ type: 'nodebuffer' });
            const pdfBuf = await libreConvert(bufWord, '.pdf', undefined);

            const nombreArchivo = `Legajo_${socioData.legajo || 'Socio'}_${socioData.apellido || ''}.pdf`.replace(/[<>:"/\\|?*]/g, '_');

            res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
            res.setHeader('Content-Type', 'application/pdf');
            res.send(pdfBuf);
        } catch (error) {
            console.error('ERROR GENERANDO PDF', error);
            return res.status(500).json({ error: 'Error al generar el PDF.', detalle: error.message || String(error) });
        }
    } catch (error) {
        console.error('Error general en generar-pdf:', error);
        res.status(500).json({ error: 'Error interno del servidor.', detalle: error.message || String(error) });
    }
});

// --- API: CANCHAS Y RESERVAS ---
app.get('/api/canchas/reservas', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM reservas ORDER BY fecha DESC, horario_inicio DESC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/canchas/reservar', bloquearEspectador, async (req, res) => {
    const { nombre, dni, telefono, fecha, horario_inicio, horario_fin, cancha, tipo, monto } = req.body;

    try {
        const { rows } = await pool.query(
            `SELECT * FROM reservas WHERE cancha = $1 AND fecha = $2 AND (
                (horario_inicio <= $3 AND horario_fin > $3) OR
                (horario_inicio < $4 AND horario_fin >= $4) OR
                (horario_inicio >= $3 AND horario_fin <= $4)
            )`,
            [cancha, fecha, horario_inicio, horario_fin]
        );

        if (rows.length > 0) {
            return res.status(400).json({ error: 'El horario seleccionado ya se encuentra ocupado en esta cancha. Elija otro rango libre.' });
        }

        const insert = await pool.query(
            `INSERT INTO reservas (nombre, dni, telefono, fecha, horario_inicio, horario_fin, cancha, tipo, monto, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pendiente') RETURNING id`,
            [nombre, dni, telefono, fecha, horario_inicio, horario_fin, cancha, tipo, monto]
        );
        res.json({ success: true, id: insert.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/canchas/pagar', bloquearEspectador, async (req, res) => {
    const { id, monto, descripcion } = req.body;
    const fechaHoy = new Date().toISOString().split('T')[0];
    const horaActual = new Date().toTimeString().split(' ')[0];

    try {
        await pool.query(`UPDATE reservas SET estado = 'Pagado' WHERE id = $1`, [id]);
        await pool.query(`INSERT INTO caja (fecha, hora, tipo, descripcion, monto) VALUES ($1, $2, 'Ingreso', $3, $4)`, [fechaHoy, horaActual, descripcion, monto]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/canchas/reservas/:id', async (req, res) => {
    if (req.session.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo el administrador puede corregir o borrar turnos.' });
    }
    try {
        await pool.query(`DELETE FROM reservas WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: CAJA ---
app.get('/api/caja', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM caja ORDER BY fecha DESC, id DESC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/caja/movimiento', bloquearEspectador, async (req, res) => {
    const { tipo, descripcion, monto } = req.body;
    const fechaHoy = new Date().toISOString().split('T')[0];
    const horaActual = new Date().toTimeString().split(' ')[0];

    try {
        const insert = await pool.query(
            `INSERT INTO caja (fecha, hora, tipo, descripcion, monto) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [fechaHoy, horaActual, tipo, descripcion, monto]
        );
        res.json({ success: true, id: insert.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/caja/:id', async (req, res) => {
    if (req.session.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo el administrador puede eliminar movimientos de caja.' });
    }
    try {
        await pool.query(`DELETE FROM caja WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: USUARIOS ---
app.get('/api/usuarios', async (req, res) => {
    if (req.session.rol !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    try {
        const { rows } = await pool.query(`SELECT id, nombre_completo, usuario, rol FROM usuarios`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/usuarios', async (req, res) => {
    if (req.session.rol !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    const { nombre_completo, usuario, password, rol } = req.body;
    try {
        const insert = await pool.query(
            `INSERT INTO usuarios (nombre_completo, usuario, password, rol) VALUES ($1, $2, $3, $4) RETURNING id`,
            [nombre_completo, usuario, password, rol || 'operador']
        );
        res.json({ success: true, id: insert.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/usuarios/:id', async (req, res) => {
    if (req.session.rol !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    try {
        await pool.query(`DELETE FROM usuarios WHERE id = $1 AND usuario != 'admin'`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
