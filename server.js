const express = require('express');
const cors = require('cors');
const mysql = require('mysql2'); // 1. Importamos la librería para conectar MySQL

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DEL SERVIDOR ---
app.use(cors());
app.use(express.json());
// 1. Sirve todos los archivos de tu carpeta (CSS, JS del cliente, imágenes)
app.use(express.static(__dirname));

// 2. Ruta para enviar el HTML principal al entrar a la raíz "/"
const path = require('path');
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); 
    // Nota: Si tu archivo visual se llama diferente a 'index.html', cambia ese nombre aquí.
});
// --- CONEXIÓN REAL A LA BASE DE DATOS ---
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '1234', 
    database: process.env.DB_NAME || 'crm_ventas',
    port: process.env.DB_PORT || 3306,
    // Esto le permite a Node.js conectarse de forma segura a Aiven:
    ssl: {
        rejectUnauthorized: false
    }
});
db.connect((err) => {
    if (err) {
        console.error('❌ Error conectando a MySQL:', err.message);
        return;
    }
    console.log('✨ ¡Conectado con éxito a la base de datos MySQL!');
});


// --- RUTAS (ENDPOINTS) CON CONSULTAS A LA BASE DE DATOS ---
app.get('/api/vendedores', (req, res) => {
    const sql = "SELECT id, nombre FROM vendedores ORDER BY nombre ASC";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ Error al traer vendedores:", err);
            return res.status(500).json({ error: "Error en el servidor" });
        }
        res.json(results);
    });
});
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
// 3. Ruta para REGISTRAR una actividad (POST) - Versión optimizada con ID
app.post('/api/registrar', (req, res) => {
    let { vendedor, cliente, tipoActividad, notas } = req.body; // 'vendedor' ahora es el ID (ej: 1 o 2)

    let tipoClave = tipoActividad ? tipoActividad.trim().toLowerCase() : '';

    if (tipoClave.includes('llamada')) tipoClave = 'llamadas';
    if (tipoClave.includes('mensaje')) tipoClave = 'mensajes';
    if (tipoClave.includes('visita'))  tipoClave = 'visitas';

    // ¡Mucho más directo! Insertamos usando directamente el ID que mandó el select del frontend
    const insertQuery = 'INSERT INTO actividades (vendedor_id, cliente, tipo_actividad, notas) VALUES (?, ?, ?, ?)';
    
    db.query(insertQuery, [vendedor, cliente, tipoClave, notas], (err, result) => {
        if (err) {
            console.error("❌ Error al insertar actividad:", err);
            return res.status(500).json({ error: err.message });
        }

        console.log(`✅ ¡Actividad guardada en MySQL para el vendedor ID: ${vendedor}!`);

        res.json({
            mensaje: "¡Actividad registrada y guardada permanentemente en MySQL!",
            idActividad: result.insertId
        });
    });
});


app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});