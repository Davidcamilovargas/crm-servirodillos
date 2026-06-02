const express = require('express');
const cors = require('cors');
const mysql = require('mysql2'); // 1. Importamos la librería para conectar MySQL

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DEL SERVIDOR ---
app.use(cors());
app.use(express.json());

// --- CONEXIÓN REAL A LA BASE DE DATOS ---
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '1234', 
    database: process.env.DB_NAME || 'crm_ventas',
    port: process.env.DB_PORT || 3306
});

db.connect((err) => {
    if (err) {
        console.error('❌ Error conectando a MySQL:', err.message);
        return;
    }
    console.log('✨ ¡Conectado con éxito a la base de datos MySQL!');
});


// --- RUTAS (ENDPOINTS) CON CONSULTAS A LA BASE DE DATOS ---

// 1. Ruta para ver el balance actual (GET) - Trae los datos calculados desde MySQL
app.get('/api/balance', (req, res) => {
    const query = `
        SELECT v.nombre AS vendedore_nombre, 
               SUM(CASE WHEN a.tipo_actividad = 'llamadas' THEN 1 ELSE 0 END) AS llamadas,
               SUM(CASE WHEN a.tipo_actividad = 'mensajes' THEN 1 ELSE 0 END) AS mensajes,
               SUM(CASE WHEN a.tipo_actividad = 'visitas' THEN 1 ELSE 0 END) AS visitas
        FROM vendedores v
        LEFT JOIN actividades a ON v.id = a.vendedor_id
        GROUP BY v.id;
    `;

    db.query(query, (err, resultados) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Formateamos la respuesta para que el frontend (HTML) la entienda perfectamente
        let balance = {};
        resultados.forEach(row => {
            balance[row.vendedore_nombre] = {
                llamadas: Number(row.llamadas),
                mensajes: Number(row.mensajes),
                visitas: Number(row.visitas)
            };
        });
        res.json(balance);
    });
});

// 2. Ruta para ver todo el historial (GET) - Trae las filas reales guardadas en el disco duro
app.get('/api/historial', (req, res) => {
    const query = `
        SELECT a.id, v.nombre AS vendedor, a.cliente, a.tipo_actividad AS tipoActividad, a.notas AS notas, a.fecha 
        FROM actividades a
        JOIN vendedores v ON a.vendedor_id = v.id
        ORDER BY a.fecha DESC;
    `;

    db.query(query, (err, resultados) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(resultados);
    });
});

// 3. Ruta para REGISTRAR una actividad (POST) - Guarda directamente en MySQL
app.post('/api/registrar', (req, res) => {
    let { vendedor, cliente, tipoActividad, notas } = req.body;

    const vendedorClave = vendedor ? vendedor.trim() : '';
    let tipoClave = tipoActividad ? tipoActividad.trim().toLowerCase() : '';

    if (tipoClave.includes('llamada')) tipoClave = 'llamadas';
    if (tipoClave.includes('mensaje')) tipoClave = 'mensajes';
    if (tipoClave.includes('visita'))  tipoClave = 'visitas';

    // PASO A: Buscamos el ID del vendedor usando su nombre (sin importar mayúsculas/minúsculas)
    db.query('SELECT id FROM vendedores WHERE LOWER(nombre) = LOWER(?)', [vendedorClave], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (rows.length === 0) {
            return res.status(400).json({ error: `El vendedor '${vendedorClave}' no existe en la base de datos.` });
        }

        const vendedorId = rows[0].id;

        // PASO B: Insertamos la actividad en la tabla usando el ID del vendedor
        const insertQuery = 'INSERT INTO actividades (vendedor_id, cliente, tipo_actividad, notas) VALUES (?, ?, ?, ?)';
        db.query(insertQuery, [vendedorId, cliente, tipoClave, notas], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });

            console.log(`✅ ¡Actividad guardada en MySQL para el vendedor ID: ${vendedorId}!`);

            res.json({
                mensaje: "¡Actividad registrada y guardada permanentemente en MySQL!",
                idActividad: result.insertId
            });
        });
    });
});


app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});