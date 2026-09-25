const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db'); // Ajusta el nombre de tu base de datos

db.serialize(() => {
    // Asegurar que exista la columna de rol (ajusta 'rol' al nombre que use tu sistema)
    db.run(`ALTER TABLE usuarios ADD COLUMN rol TEXT`, (err) => {});

    // Actualizar o insertar el usuario con el rol de administrador
    const query = `UPDATE usuarios SET rol = 'admin' WHERE usuario = 'admi'`;
    db.run(query, function(err) {
        if (err) {
            console.error('Error al actualizar el rol:', err.message);
        } else {
            console.log(`Rol de administrador asignado correctamente. Filas modificadas: ${this.changes}`);
        }
    });
});

db.close();