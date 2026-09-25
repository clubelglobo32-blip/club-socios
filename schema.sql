-- Ejecutar TODO este archivo una sola vez en Supabase → SQL Editor → New query → Run

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre_completo TEXT,
    usuario TEXT UNIQUE,
    password TEXT,
    rol TEXT DEFAULT 'operador'
);

INSERT INTO usuarios (nombre_completo, usuario, password, rol)
VALUES ('Administrador General', 'admin', '291019', 'admin')
ON CONFLICT (usuario) DO NOTHING;

CREATE TABLE IF NOT EXISTS ajustes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    nombre_club TEXT,
    logo_url TEXT,
    plantilla_word TEXT,
    email_contacto TEXT,
    telefono_contacto TEXT,
    proximo_legajo INTEGER,
    precio_sintetico_f5 REAL,
    precio_futsal REAL,
    precio_pasto_f11 REAL,
    cant_sintetico_f5 INTEGER,
    cant_futsal INTEGER,
    cant_pasto_f11 INTEGER,
    inscripcion_socio REAL,
    cuota_jugador REAL,
    cuota_transitorio REAL,
    cuota_pleno REAL
);

INSERT INTO ajustes (
    id, nombre_club, logo_url, plantilla_word, email_contacto, telefono_contacto, proximo_legajo,
    precio_sintetico_f5, precio_futsal, precio_pasto_f11,
    cant_sintetico_f5, cant_futsal, cant_pasto_f11,
    inscripcion_socio, cuota_jugador, cuota_transitorio, cuota_pleno
) VALUES (1, 'Club Manager Pro', '', '', 'contacto@club.com', '', 120, 12000, 15000, 20000, 2, 1, 1, 10000, 6000, 5000, 8000)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS socios (
    id SERIAL PRIMARY KEY,
    legajo INTEGER UNIQUE,
    nombre TEXT,
    apellido TEXT,
    dni TEXT,
    fecha_nacimiento TEXT,
    fecha_alta TEXT,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    nacionalidad TEXT,
    estado_civil TEXT,
    categoria TEXT,
    estado TEXT DEFAULT 'Al día',
    archivo_firma TEXT,
    creado_por TEXT
);

CREATE TABLE IF NOT EXISTS pagos_socios (
    id SERIAL PRIMARY KEY,
    socio_id INTEGER REFERENCES socios(id),
    concepto TEXT,
    detalle TEXT,
    monto REAL,
    comprobante TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservas (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    dni TEXT,
    telefono TEXT,
    fecha TEXT,
    horario_inicio TEXT,
    horario_fin TEXT,
    cancha TEXT,
    tipo TEXT,
    monto REAL,
    estado TEXT DEFAULT 'Pendiente'
);

CREATE TABLE IF NOT EXISTS caja (
    id SERIAL PRIMARY KEY,
    fecha TEXT,
    hora TEXT,
    tipo TEXT,
    descripcion TEXT,
    monto REAL
);
