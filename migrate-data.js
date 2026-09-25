// Migra los datos reales de tu database.db (SQLite) hacia Supabase (Postgres).
// Se ejecuta UNA SOLA VEZ, de forma local, después de:
//   1) Crear el proyecto en Supabase.
//   2) Ejecutar schema.sql en el SQL Editor de Supabase.
//   3) Completar el archivo .env con tu DATABASE_URL real.
//
// Uso:  node migrate-data.js
// Requiere que database.db (el archivo viejo) esté en esta misma carpeta.

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.db'));
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function all(sql) {
    return new Promise((resolve, reject) => {
        db.all(sql, [], (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

async function migrarTabla(tabla, columnas) {
    const filas = await all(`SELECT * FROM ${tabla}`);
    console.log(`→ Migrando ${filas.length} filas de "${tabla}"...`);

    const cols = columnas.join(', ');
    const placeholders = columnas.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columnas.filter(c => c !== 'id').map(c => `${c} = EXCLUDED.${c}`).join(', ');

    for (const fila of filas) {
        const valores = columnas.map(c => fila[c]);
        await pool.query(
            `INSERT INTO ${tabla} (${cols}) VALUES (${placeholders})
             ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
            valores
        );
    }

    if (filas.length > 0) {
        await pool.query(`SELECT setval(pg_get_serial_sequence('${tabla}', 'id'), (SELECT MAX(id) FROM ${tabla}))`);
    }
    console.log(`✔ "${tabla}" migrada correctamente (${filas.length} filas).`);
}

(async () => {
    try {
        await migrarTabla('usuarios', ['id', 'nombre_completo', 'usuario', 'password', 'rol']);
        await migrarTabla('ajustes', [
            'id', 'nombre_club', 'logo_url', 'plantilla_word', 'email_contacto', 'telefono_contacto', 'proximo_legajo',
            'precio_sintetico_f5', 'precio_futsal', 'precio_pasto_f11',
            'cant_sintetico_f5', 'cant_futsal', 'cant_pasto_f11',
            'inscripcion_socio', 'cuota_jugador', 'cuota_transitorio', 'cuota_pleno'
        ]);
        await migrarTabla('socios', [
            'id', 'legajo', 'nombre', 'apellido', 'dni', 'fecha_nacimiento', 'fecha_alta', 'direccion',
            'telefono', 'email', 'nacionalidad', 'estado_civil', 'categoria', 'estado', 'archivo_firma', 'creado_por'
        ]);
        await migrarTabla('pagos_socios', ['id', 'socio_id', 'concepto', 'detalle', 'monto', 'comprobante', 'fecha']);
        await migrarTabla('reservas', ['id', 'nombre', 'dni', 'telefono', 'fecha', 'horario_inicio', 'horario_fin', 'cancha', 'tipo', 'monto', 'estado']);
        await migrarTabla('caja', ['id', 'fecha', 'hora', 'tipo', 'descripcion', 'monto']);

        console.log('\n✅ Migración completa. Ya podés revisar los datos en Supabase (Table Editor).');
        console.log('   Nota: los ARCHIVOS (fotos, comprobantes, la plantilla Word) no se migran con este script,');
        console.log('   porque estaban guardados en el disco local. Estos hay que volver a subirlos desde Ajustes');
        console.log('   y desde cada socio, una vez que el sistema ya esté corriendo contra Supabase.');
    } catch (err) {
        console.error('❌ Error durante la migración:', err);
    } finally {
        db.close();
        await pool.end();
    }
})();
