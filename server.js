const express = require('express');
const cors = require('cors');
const mysql = require('mysql2'); 
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/css', express.static(path.join(__dirname, 'css')));

app.get('/',        (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login',   (req, res) => res.sendFile(path.join(__dirname, 'paginas', 'login.html')));
app.get('/clientes',(req, res) => res.sendFile(path.join(__dirname, 'paginas', 'clientes.html')));
app.get('/reporte', (req, res) => res.sendFile(path.join(__dirname, 'paginas', 'reporte.html')));

// --- BASE DE DATOS ---
const db = mysql.createPool({
    host:     process.env.DB_HOST     || "mysql-2d9ef1b2-davidleon1004-b427.l.aivencloud.com",
    user:     process.env.DB_USER     || "avnadmin",
    password: process.env.DB_PASSWORD || "TU_CONTRASEÑA_DE_AIVEN",
    database: process.env.DB_NAME     || "defaultdb",
    port:     process.env.DB_PORT     || 12345,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false }
});

// ✅ METAS PERSONALIZADAS POR VENDEDOR
const METAS_VENDEDORES = {
    1: 80000000,   // Ismael Vargas → $80.000.000
    2: 30000000,   // David Vargas  → $30.000.000
};
const META_DEFAULT = 15000000;

function getMetaVendedor(vendedorId) {
    return METAS_VENDEDORES[parseInt(vendedorId)] || META_DEFAULT;
}


// ─────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: "Por favor, ingresa correo y contraseña." });

    const sql = "SELECT id, nombre, email, rol FROM vendedores WHERE LOWER(email) = LOWER(?) AND password = ?";
    db.query(sql, [email.trim(), password], (err, results) => {
        if (err) return res.status(500).json({ error: "Error interno del servidor" });
        if (results.length === 0)
            return res.status(401).json({ error: "Correo o contraseña incorrectos." });

        const usuario = results[0];
        console.log(`🔑 Login: ${usuario.nombre} (${usuario.rol})`);

        res.json({
            mensaje: "Inicio de sesión exitoso",
            usuario: {
                id:     usuario.id,
                nombre: usuario.nombre,
                email:  usuario.email,
                rol:    usuario.rol,
                meta:   getMetaVendedor(usuario.id)
            }
        });
    });
});


// ─────────────────────────────────────────
//  BALANCE
// ─────────────────────────────────────────
app.get('/api/balance', (req, res) => {
    const { vendedorId } = req.query;
    let query = `
        SELECT v.nombre AS vendedore_nombre, 
               SUM(CASE WHEN a.tipo_actividad = 'llamadas' THEN 1 ELSE 0 END) AS llamadas,
               SUM(CASE WHEN a.tipo_actividad = 'mensajes' THEN 1 ELSE 0 END) AS mensajes,
               SUM(CASE WHEN a.tipo_actividad = 'visitas'  THEN 1 ELSE 0 END) AS visitas
        FROM vendedores v
        LEFT JOIN actividades a ON v.id = a.vendedor_id
    `;
    const queryParams = [];
    if (vendedorId) { query += ` WHERE v.id = ?`; queryParams.push(vendedorId); }
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


// ─────────────────────────────────────────
//  HISTORIAL
// ─────────────────────────────────────────
app.get('/api/historial', (req, res) => {
    const { vendedorId } = req.query;
    let query = `
        SELECT a.id, v.nombre AS vendedor, a.cliente, a.tipo_actividad AS tipoActividad, a.notas, a.fecha 
        FROM actividades a
        JOIN vendedores v ON a.vendedor_id = v.id
    `;
    const queryParams = [];
    if (vendedorId) { query += ` WHERE a.vendedor_id = ?`; queryParams.push(vendedorId); }
    query += ` ORDER BY a.fecha DESC;`;

    db.query(query, queryParams, (err, resultados) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(resultados);
    });
});


// ─────────────────────────────────────────
//  REGISTRAR ACTIVIDAD
// ─────────────────────────────────────────
app.post('/api/registrar', (req, res) => {
    let { vendedor, cliente, tipoActividad, notas } = req.body;
    let tipoClave = tipoActividad ? tipoActividad.trim().toLowerCase() : '';
    if (tipoClave.includes('llamada')) tipoClave = 'llamadas';
    if (tipoClave.includes('mensaje')) tipoClave = 'mensajes';
    if (tipoClave.includes('visita'))  tipoClave = 'visitas';

    db.query(
        'INSERT INTO actividades (vendedor_id, cliente, tipo_actividad, notas) VALUES (?, ?, ?, ?)',
        [vendedor, cliente, tipoClave, notas],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: "Actividad registrada.", idActividad: result.insertId });
        }
    );
});


// ─────────────────────────────────────────
//  VENDEDORES
// ─────────────────────────────────────────
app.get('/api/vendedores', (req, res) => {
    db.query("SELECT id, nombre FROM vendedores ORDER BY nombre ASC", (err, results) => {
        if (err) return res.status(500).json({ error: "Error en el servidor" });
        res.json(results);
    });
});


// ─────────────────────────────────────────
//  PEDIDOS
// ─────────────────────────────────────────

// POST: Registrar pedido — ✅ valida duplicado antes de insertar
app.post('/api/pedidos', (req, res) => {
    const { fecha, numero_pedido, cliente_nombre, estado, valor, vendedor_id } = req.body;

    if (!fecha || !numero_pedido || !cliente_nombre || !valor || !vendedor_id)
        return res.status(400).json({ error: 'Faltan campos obligatorios.' });

    // ── 1. Verificar si el número de pedido ya existe ──
    db.query(
        `SELECT id FROM pedidos WHERE numero_pedido = ?`,
        [numero_pedido.toString().trim()],
        (err, existing) => {
            if (err) return res.status(500).json({ error: 'Error al verificar duplicado.' });

            if (existing.length > 0) {
                return res.status(409).json({
                    error: `El pedido #${numero_pedido} ya está registrado. Verifica el número e intenta de nuevo.`
                });
            }

            // ── 2. Insertar si no existe ──
            db.query(
                `INSERT INTO pedidos (fecha, numero_pedido, cliente_nombre, estado, valor, vendedor_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [fecha, numero_pedido.toString().trim(), cliente_nombre, estado || 'Pendiente', valor, vendedor_id],
                (err, result) => {
                    if (err) return res.status(500).json({ error: 'Error al guardar pedido.' });
                    console.log(`📦 Pedido #${numero_pedido} registrado (id: ${result.insertId})`);
                    res.status(201).json({ message: 'Pedido registrado', id: result.insertId });
                }
            );
        }
    );
});

// GET: Obtener pedidos + KPIs con meta personalizada
app.get('/api/pedidos', (req, res) => {
    const { vendedorId, mes, anio } = req.query;

    const fechaActual = new Date();
    const filtroMes   = mes  ? parseInt(mes)  : (fechaActual.getMonth() + 1);
    const filtroAnio  = anio ? parseInt(anio) : fechaActual.getFullYear();

    const fechaInicio = `${filtroAnio}-${String(filtroMes).padStart(2,'0')}-01`;
    const ultimoDia   = new Date(filtroAnio, filtroMes, 0).getDate();
    const fechaFin    = `${filtroAnio}-${String(filtroMes).padStart(2,'0')}-${String(ultimoDia).padStart(2,'0')}`;

    console.log(`📅 Pedidos: ${fechaInicio} → ${fechaFin} | vendedor: ${vendedorId || 'todos'}`);

    let query  = `SELECT * FROM pedidos WHERE fecha BETWEEN ? AND ?`;
    let params = [fechaInicio, fechaFin];

    const esVendedorEspecifico = vendedorId &&
        vendedorId !== 'todos' &&
        vendedorId !== 'null' &&
        vendedorId !== 'undefined';

    if (esVendedorEspecifico) {
        query += ` AND vendedor_id = ?`;
        params.push(vendedorId);
    }
    query += ` ORDER BY fecha DESC`;

    db.query(query, params, (err, pedidos) => {
        if (err) return res.status(500).json({ error: 'Error interno', detalle: err.message });

        const totalVenta = pedidos.reduce((sum, p) => sum + parseFloat(p.valor || 0), 0);

        let metaMes;
        if (esVendedorEspecifico) {
            metaMes = getMetaVendedor(vendedorId);
        } else {
            metaMes = Object.values(METAS_VENDEDORES).reduce((a, b) => a + b, 0);
        }

        const restante = metaMes - totalVenta;
        console.log(`✅ ${pedidos.length} pedidos | Total: $${totalVenta} | Meta: $${metaMes}`);

        res.json({
            pedidos,
            kpis: { totalVenta, meta: metaMes, restante }
        });
    });
});

// PUT: Editar pedido completo (todos los campos) — ✅ nuevo
app.put('/api/pedidos/:id', (req, res) => {
    const { id } = req.params;
    const { estado, fecha, numero_pedido, cliente_nombre, valor } = req.body;

    // Si solo viene el estado (cambio rápido desde la tabla), actualizar solo ese campo
    if (estado && !fecha && !numero_pedido && !cliente_nombre && !valor) {
        db.query(
            `UPDATE pedidos SET estado = ? WHERE id = ?`,
            [estado, id],
            (err) => {
                if (err) return res.status(500).json({ error: 'Error al actualizar estado.' });
                res.json({ message: 'Estado actualizado.' });
            }
        );
        return;
    }

    // Edición completa desde el modal
    if (!fecha || !numero_pedido || !cliente_nombre || !valor || !estado)
        return res.status(400).json({ error: 'Faltan campos obligatorios.' });

    // Verificar duplicado de número de pedido (excluyendo el propio registro)
    db.query(
        `SELECT id FROM pedidos WHERE numero_pedido = ? AND id != ?`,
        [numero_pedido.toString().trim(), id],
        (err, existing) => {
            if (err) return res.status(500).json({ error: 'Error al verificar duplicado.' });

            if (existing.length > 0) {
                return res.status(409).json({
                    error: `El pedido #${numero_pedido} ya está registrado en otro registro.`
                });
            }

            db.query(
                `UPDATE pedidos SET fecha = ?, numero_pedido = ?, cliente_nombre = ?, estado = ?, valor = ?
                 WHERE id = ?`,
                [fecha, numero_pedido.toString().trim(), cliente_nombre, estado, valor, id],
                (err) => {
                    if (err) return res.status(500).json({ error: 'Error al editar pedido.' });
                    console.log(`✏️  Pedido id:${id} editado`);
                    res.json({ message: 'Pedido actualizado.' });
                }
            );
        }
    );
});

// DELETE: Eliminar pedido — ✅ nuevo
app.delete('/api/pedidos/:id', (req, res) => {
    const { id } = req.params;

    db.query(`DELETE FROM pedidos WHERE id = ?`, [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Error al eliminar el pedido.' });

        if (result.affectedRows === 0)
            return res.status(404).json({ error: 'Pedido no encontrado.' });

        console.log(`🗑️  Pedido id:${id} eliminado`);
        res.json({ message: 'Pedido eliminado correctamente.' });
    });
});


// ─────────────────────────────────────────
//  CLIENTES
// ─────────────────────────────────────────

// GET: Listar clientes
app.get('/api/clientes', (req, res) => {
    const { vendedorId } = req.query;
    let query = 'SELECT * FROM clientes';
    const queryParams = [];
    if (vendedorId) { query += ' WHERE vendedor_id = ?'; queryParams.push(vendedorId); }
    query += ' ORDER BY nombre ASC';

    db.query(query, queryParams, (err, results) => {
        if (err) return res.status(500).json({ error: 'Error al consultar clientes.' });
        res.json(results);
    });
});

// POST: Crear cliente — ✅ nuevo
app.post('/api/clientes', (req, res) => {
    const { nombre, contacto, telefono, ciudad, vendedor_id } = req.body;

    if (!nombre || !nombre.trim())
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });

    // Verificar que no exista un cliente con el mismo nombre para este vendedor
    db.query(
        `SELECT id FROM clientes WHERE LOWER(nombre) = LOWER(?) AND vendedor_id = ?`,
        [nombre.trim(), vendedor_id],
        (err, existing) => {
            if (err) return res.status(500).json({ error: 'Error al verificar cliente.' });

            if (existing.length > 0)
                return res.status(409).json({ error: `Ya tienes un cliente llamado "${nombre}".` });

            db.query(
                `INSERT INTO clientes (nombre, contacto, telefono, ciudad, vendedor_id)
                 VALUES (?, ?, ?, ?, ?)`,
                [nombre.trim(), contacto || null, telefono || null, ciudad || null, vendedor_id],
                (err, result) => {
                    if (err) return res.status(500).json({ error: 'Error al crear cliente.' });
                    console.log(`👤 Cliente "${nombre}" creado (id: ${result.insertId})`);
                    res.status(201).json({ message: 'Cliente creado.', id: result.insertId });
                }
            );
        }
    );
});

// PUT: Editar cliente — ✅ nuevo
app.put('/api/clientes/:id', (req, res) => {
    const { id } = req.params;
    const { nombre, contacto, telefono, ciudad } = req.body;

    if (!nombre || !nombre.trim())
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });

    db.query(
        `UPDATE clientes SET nombre = ?, contacto = ?, telefono = ?, ciudad = ? WHERE id = ?`,
        [nombre.trim(), contacto || null, telefono || null, ciudad || null, id],
        (err, result) => {
            if (err) return res.status(500).json({ error: 'Error al actualizar cliente.' });

            if (result.affectedRows === 0)
                return res.status(404).json({ error: 'Cliente no encontrado.' });

            console.log(`✏️  Cliente id:${id} actualizado`);
            res.json({ message: 'Cliente actualizado correctamente.' });
        }
    );
});

// DELETE: Eliminar cliente — ✅ nuevo
app.delete('/api/clientes/:id', (req, res) => {
    const { id } = req.params;

    db.query(`DELETE FROM clientes WHERE id = ?`, [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Error al eliminar el cliente.' });

        if (result.affectedRows === 0)
            return res.status(404).json({ error: 'Cliente no encontrado.' });

        console.log(`🗑️  Cliente id:${id} eliminado`);
        res.json({ message: 'Cliente eliminado correctamente.' });
    });
});


// ─────────────────────────────────────────
//  INICIALIZACIÓN
// ─────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));