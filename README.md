# Club Manager Pro — Sistema de gestión de club

Sistema interno para gestionar socios, pagos, legajos, caja y reservas de cancha.

## Arquitectura

- **Backend:** Node.js + Express (`server.js`)
- **Base de datos:** PostgreSQL, alojada en **Supabase**
- **Archivos (logo, plantilla Word, comprobantes, firmas):** **Supabase Storage**
- **Frontend:** HTML/JS simple, servido por el mismo Express (`/public`)
- **Hosting del servidor:** un servicio aparte (Render, Railway, Fly.io, etc.) — Supabase NO corre el `server.js`, solo la base de datos y el storage.

```
GitHub (código) ──▶ Hosting (Render/Railway/...) ──▶ corre server.js
                                                          │
                                                          ▼
                                                     Supabase (Postgres + Storage)
```

## 1) Preparar Supabase

1. Creá una cuenta y un proyecto nuevo en https://supabase.com (elegí una contraseña de base de datos y guardala).
2. Andá a **SQL Editor → New query**, pegá todo el contenido de `schema.sql` de este proyecto, y ejecutalo (`Run`). Esto crea las tablas y el usuario `admin` inicial.
3. Andá a **Storage** → creá un bucket nuevo llamado `club-archivos` (o el nombre que quieras, después lo ponés en `.env`) y marcalo como **público** (para que las fotos/comprobantes/legajos se puedan ver desde los tickets y el padrón).
4. Andá a **Project Settings → Database → Connection string → URI** y copiala (esa es tu `DATABASE_URL`). Reemplazá `[YOUR-PASSWORD]` por la contraseña que pusiste en el paso 1.
5. Andá a **Project Settings → API** y copiá el **Project URL** (`SUPABASE_URL`) y la **service_role key** (`SUPABASE_SERVICE_KEY`, es secreta, no la compartas).

## 2) Configurar el proyecto localmente

```bash
cd sistema-club
cp .env.example .env
```

Editá `.env` y completá `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` y `SESSION_SECRET` con los datos del paso anterior.

```bash
npm install
npm start
```

Probá que ande en `http://localhost:3000` con el usuario `admin` / `291019` (cambiá esa contraseña luego desde Usuarios).

## 3) Migrar tus datos reales (los que ya cargaste en la app vieja)

Si ya venías usando el sistema con el `database.db` de SQLite y tenés socios/pagos/reservas cargados:

1. Asegurate de que el archivo `database.db` viejo esté en la raíz del proyecto.
2. Con el `.env` ya completo, corré:

```bash
npm run migrate-data
```

Esto copia usuarios, ajustes, socios, pagos, reservas y caja a Supabase. **Los archivos** (fotos, comprobantes, la plantilla Word) no se migran solos —tenés que volver a subirlos manualmente una vez desde la app (Ajustes → logo y plantilla; cada socio → legajo firmado), porque estaban en el disco local viejo.

## 4) Subir el código a GitHub

Este proyecto ya tiene `git init` hecho y el primer commit listo. Solo falta conectarlo a un repositorio remoto:

1. Creá un repositorio nuevo y vacío en https://github.com/new (no le pongas README ni .gitignore, ya los tenemos).
2. Copiá la URL que te da GitHub y corré:

```bash
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git branch -M main
git push -u origin main
```

## 5) Desplegar el servidor (Render, como ejemplo)

Cualquier hosting de Node sirve; con Render (tiene plan gratuito) es así:

1. Entrá a https://render.com, conectá tu cuenta de GitHub.
2. **New → Web Service**, elegí el repo que acabás de subir.
3. Build command: `npm install` — Start command: `npm start`.
4. En **Environment**, cargá las mismas variables del `.env` (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET`, `SESSION_SECRET`).
5. Deploy. Cada `git push` a `main` vuelve a desplegar solo.

## Notas importantes

- **Contraseñas en texto plano:** el login todavía compara contraseñas sin encriptar. Es la mejora de seguridad más urgente pendiente (ver conversación anterior sobre `bcrypt`).
- **Archivos:** ya no se guardan en el disco del servidor (se perderían en cada redeploy) — van a Supabase Storage.
- **Sesión:** las sesiones de login ahora se guardan en la tabla `session` de Postgres (vía `connect-pg-simple`), no en memoria, para que no se corten al reiniciar el servidor.
