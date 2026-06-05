const express = require('express');
const cors = require('cors');
const mysql = require('mysql2'); 
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DEL SERVIDOR ---
app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));
app.use('/css', express.static(path.join(__dirname, 'css')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); 
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'paginas', 'login.html'));
});

app.get('/clientes', (req, res) => {
    res.sendFile(path.join(__dirname, 'paginas', 'clientes.html'));
});

app.get('/reporte', (req, res) => {
    res.sendFile(path.join(__dirname, 'paginas', 'reporte.html'));
});

// --- CONFIGURACIÓN DE LA BASE DE DATOS ---
const db = mysql.createPool({
    host: process.env.DB_HOST || "mysql-2d9ef1b2-davidleon1004-b427.l.aivencloud.com",
    user: process.env.DB_USER || "avnadmin",
    password: process.env.DB_PASSWORD || "TU_CONTRASEÑA_DE_AIVEN",
    database: process.env.DB_NAME || "defaultdb",
    port: process.env.DB_PORT || 12345,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false }
});


// --- RUTA: INICIO DE SESIÓN (POST) ---
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
        console.log(`🔑 Sesión iniciada: ${usuario.nombre} (Rol: ${usuario.rol})`);
        
        // ✅ FIX: "rol" en español, consistente con todo el frontend
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


// --- RUTA: VER BALANCE (GET) ---
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
                visitas:  Number(row.visitas)
            };
        });
        res.json(balance);
    });
});


// --- RUTA: VER HISTORIAL (GET) ---
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


// --- RUTA: REGISTRAR UNA ACTIVIDAD (POST) ---
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
        console.log(`✅ Actividad guardada para vendedor ID: ${vendedor}`);
        res.json({ mensaje: "Actividad registrada correctamente.", idActividad: result.insertId });
    });
});


// --- RUTA: LISTAR VENDEDORES (GET) ---
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


// --- ENDPOINTS REPORTE COMERCIAL MENSUAL ---

// 1. REGISTRAR UN NUEVO PEDIDO
app.post('/api/pedidos', (req, res) => {
    const { fecha, numero_pedido, cliente_nombre, estado, valor, vendedor_id } = req.body;
    
    if (!fecha || !numero_pedido || !cliente_nombre || !valor || !vendedor_id) {
        return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    }

    const query = `INSERT INTO pedidos (fecha, numero_pedido, cliente_nombre, estado, valor, vendedor_id) VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.query(query, [fecha, numero_pedido, cliente_nombre, estado || 'Pendiente', valor, vendedor_id], (err, result) => {
        if (err) {
            console.error("❌ Error al guardar pedido:", err);
            return res.status(500).json({ error: 'Error al guardar pedido' });
        }
        res.status(201).json({ message: 'Pedido registrado', id: result.insertId });
    });
});

// 2. OBTENER PEDIDOS FILTRADOS POR MES, AÑO Y VENDEDOR + KPIs
app.get('/api/pedidos', (req, res) => {
    const { vendedorId, mes, anio } = req.query; 
    
    const fechaActual = new Date();
    const filtroMes  = mes  ? parseInt(mes)  : (fechaActual.getMonth() + 1);
    const filtroAnio = anio ? parseInt(anio) : fechaActual.getFullYear();

    const fechaInicio = `${filtroAnio}-${String(filtroMes).padStart(2, '0')}-01`;

    // ✅ FIX CRÍTICO: Calcular el último día real del mes
    // Día 0 del mes siguiente = último día del mes actual
    const ultimoDia = new Date(filtroAnio, filtroMes, 0).getDate();
    const fechaFin  = `${filtroAnio}-${String(filtroMes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    console.log(`📅 Consultando pedidos: ${fechaInicio} → ${fechaFin} | vendedorId: ${vendedorId || 'todos'}`);

    let query  = `SELECT * FROM pedidos WHERE fecha BETWEEN ? AND ?`;
    let params = [fechaInicio, fechaFin];

    if (vendedorId && vendedorId !== 'todos' && vendedorId !== 'null' && vendedorId !== 'undefined') {
        query += ` AND vendedor_id = ?`;
        params.push(vendedorId);
    }

    query += ` ORDER BY fecha DESC`;

    db.query(query, params, (err, pedidos) => {
        if (err) {
            console.error('❌ Error en la base de datos:', err);
            return res.status(500).json({ error: 'Error interno al cargar el reporte', detalle: err.message });
        }

        const totalVenta = pedidos.reduce((sum, p) => sum + parseFloat(p.valor || 0), 0);
        const META_MES   = 15000000; 
        const restante   = META_MES - totalVenta;

        console.log(`✅ Pedidos encontrados: ${pedidos.length} | Total: $${totalVenta}`);

        res.json({
            pedidos: pedidos,
            kpis: { totalVenta, meta: META_MES, restante }
        });
    });
});

// 3. EDITAR ESTADO DE UN PEDIDO
app.put('/api/pedidos/:id', (req, res) => {
    const { id }     = req.params;
    const { estado } = req.body;

    if (!estado) return res.status(400).json({ error: 'El estado es requerido.' });

    const query = `UPDATE pedidos SET estado = ? WHERE id = ?`;
    
    db.query(query, [estado, id], (err) => {
        if (err) {
            console.error("❌ Error al actualizar estado:", err);
            return res.status(500).json({ error: 'Error al actualizar el estado del pedido' });
        }
        res.json({ message: 'Pedido actualizado con éxito' });
    });
});


// --- RUTA: OBTENER LISTA DE CLIENTES ---
app.get('/api/clientes', (req, res) => {
    const { vendedorId } = req.query; 

    let query = 'SELECT * FROM clientes';
    const queryParams = [];

    if (vendedorId) {
        query += ' WHERE vendedor_id = ?';
        queryParams.push(vendedorId);
    }
    query += ' ORDER BY nombre ASC';

    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error('❌ Error al obtener clientes:', err);
            return res.status(500).json({ error: 'Error interno al consultar clientes' });
        }
        res.json(results);
    });
});


// --- INICIALIZACIÓN DEL SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor CRM corriendo en http://localhost:${PORT}`);
});