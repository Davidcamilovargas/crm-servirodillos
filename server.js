const express = require('express');
const cors = require('cors');
const mysql = require('mysql2'); 
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DEL SERVIDOR ---
app.use(cors());
app.use(express.json());

// Sirve todos los archivos de tu carpeta (CSS, JS del cliente, imágenes)
app.use(express.static(__dirname));

// Ruta para enviar el HTML principal al entrar a la raíz "/"
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); 
});

// 🌟 NUEVA RUTA: Apunta directamente a tu carpeta 'paginas'
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'paginas', 'login.html'));
});

// --- 🛠️ CONFIGURACIÓN DE LA BASE DE DATOS CON POOL INTELIGENTE ---
// Usamos 'createPool' para que la conexión no se muera por inactividad por las mañanas
const db = mysql.createPool({
    host: process.env.DB_HOST || "mysql-2d9ef1b2-davidleon1004-b427.l.aivencloud.com",
    user: process.env.DB_USER || "avnadmin",
    password: process.env.DB_PASSWORD || "TU_CONTRASEÑA_DE_AIVEN", // Reemplaza con tu contraseña real de Aiven
    database: process.env.DB_NAME || "defaultdb",
    port: process.env.DB_PORT || 12345,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false
    }
});

// NOTA: Con createPool NO se usa db.connect(), el pool abre y cierra conexiones automáticamente.


// --- 🔒 RUTA: INICIO DE SESIÓN (POST) ---
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Por favor, ingresa correo y contraseña." });
    }

    const sql = "SELECT id, nombre, email, rol FROM vendedores WHERE LOWER(email) = LOWER(?) AND password = ?";
    
    db.query(sql, [email.trim(), password], (err, results) => {
        if (err) {
            console.error("❌ Error en el login:", err);
            return res.status(500).json({ error: "Error interno del servidor" });
        }

        if (results.length === 0) {
            return res.status(401).json({ error: "Correo o contraseña incorrectos." });
        }

        const usuario = results[0];
        console.log(`🔑 Sesión iniciada para: ${usuario.nombre} (Rol: ${usuario.rol})`);
        
        res.json({
            mensaje: "Inicio de sesión exitoso",
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol: usuario.rol
            }
        });
    });
});


// --- 📊 RUTA: VER BALANCE (GET) ---
// Filtra dinámicamente: Si llega '?vendedorId=X' calcula solo lo de ese vendedor. Si no, trae todo.
app.get('/api/balance', (req, res) => {
    const { vendedorId } = req.query; 

    let query = `
        SELECT v.nombre AS vendedore_nombre, 
               SUM(CASE WHEN a.tipo_actividad = 'llamadas' THEN 1 ELSE 0 END) AS llamadas,
               SUM(CASE WHEN a.tipo_actividad = 'mensajes' THEN 1 ELSE 0 END) AS mensajes,
               SUM(CASE WHEN a.tipo_actividad = 'visitas' THEN 1 ELSE 0 END) AS visitas
        FROM vendedores v
        LEFT JOIN actividades a ON v.id = a.vendedor_id
    `;

    const queryParams = [];

    if (vendedorId) {
        query += ` WHERE v.id = ?`;
        queryParams.push(vendedorId);
    }

    query += ` GROUP BY v.id;`;

    db.query(query, queryParams, (err, resultados) => {
        if (err) return res.status(500).json({ error: err.message });
        
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


// --- 📜 RUTA: VER HISTORIAL (GET) ---
// Si llega '?vendedorId=X' restringe el historial para que el vendedor solo vea lo suyo.
app.get('/api/historial', (req, res) => {
    const { vendedorId } = req.query;

    let query = `
        SELECT a.id, v.nombre AS vendedor, a.cliente, a.tipo_actividad AS tipoActividad, a.notas AS notas, a.fecha 
        FROM actividades a
        JOIN vendedores v ON a.vendedor_id = v.id
    `;

    const queryParams = [];

    if (vendedorId) {
        query += ` WHERE a.vendedor_id = ?`;
        queryParams.push(vendedorId);
    }

    query += ` ORDER BY a.fecha DESC;`;

    db.query(query, queryParams, (err, resultados) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(resultados);
    });
});


// --- 🚀 RUTA: REGISTRAR UNA ACTIVIDAD (POST) ---
app.post('/api/registrar', (req, res) => {
    let { vendedor, cliente, tipoActividad, notas } = req.body; 

    let tipoClave = tipoActividad ? tipoActividad.trim().toLowerCase() : '';

    if (tipoClave.includes('llamada')) tipoClave = 'llamadas';
    if (tipoClave.includes('mensaje')) tipoClave = 'mensajes';
    if (tipoClave.includes('visita'))  tipoClave = 'visitas';

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


// --- 👥 RUTA: LISTAR VENDEDORES (GET) ---
// Útil para llenar los selectores en la vista del administrador
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


// --- INICIALIZACIÓN DEL SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor CRM corriendo en http://localhost:${PORT}`);
});