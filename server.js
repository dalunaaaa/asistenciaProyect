import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { db } from './fine/db.js';

const app = express();
const PORT = process.env.PORT || 3000;
const IS_DEV = process.env.NODE_ENV !== 'production';

app.use(cors());
app.use(express.json());

// Simple in-memory store for recovery tokens
const recoveryTokens = new Map();
const TOKEN_EXPIRY_MS = 15 * 60 * 1000;

// 🔒 Middleware simple de autenticación
export const isAuthenticated = async (req, res, next) => {
  const userIdHeader = req.header('authorization');
  const userId = parseInt(userIdHeader, 10);

  if (!userIdHeader || Number.isNaN(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [rows] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.userId = userId;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔐 LOGIN
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan campos' });
  }
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role FROM users WHERE email = ? AND password = ?',
      [email, password]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// 🔐 SIGNUP
app.post('/api/signup', async (req, res) => {
  const { name, email, password, recoveryWord, role } = req.body;
  if (!name || !email || !password || !role || !recoveryWord) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  const allowedRoles = ['teacher', 'student', 'admin'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  try {
    const [exists] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) {
      return res.status(400).json({ error: 'El email ya existe' });
    }

    const [result] = await db.query(
      'INSERT INTO users (name, email, password, recoveryWord, role) VALUES (?, ?, ?, ?, ?)',
      [name, email, password, recoveryWord, role]
    );

    const user = { id: result.insertId, name, email, role };
    res.status(201).json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// 🔑 Verify recovery word and generate token
app.post('/api/recover-password', async (req, res) => {
  const { email, recoveryWord } = req.body;
  if (!email || !recoveryWord) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  try {
    const [rows] = await db.query(
      'SELECT id FROM users WHERE email = ? AND recoveryWord = ?',
      [email, recoveryWord]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Datos incorrectos' });
    }

    const token = uuidv4();
    recoveryTokens.set(token, rows[0].id);
    setTimeout(() => recoveryTokens.delete(token), TOKEN_EXPIRY_MS);

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// 🔄 Reset password with valid token
app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  const userId = recoveryTokens.get(token);
  if (!userId) {
    return res.status(400).json({ error: 'Token inválido' });
  }

  try {
    await db.query('UPDATE users SET password = ? WHERE id = ?', [password, userId]);
    recoveryTokens.delete(token);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ✅ Nuevo flujo simple de recuperación de contraseña
app.post('/api/password-recovery', async (req, res) => {
  const { email, recoveryWord } = req.body;
  if (!email || !recoveryWord) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  try {
    const [rows] = await db.query(
      'SELECT id FROM users WHERE email = ? AND recoveryWord = ?',
      [email, recoveryWord]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Datos incorrectos' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.post('/api/password-reset', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  try {
    const [result] = await db.query('UPDATE users SET password = ? WHERE email = ?', [password, email]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ✅ Ruta protegida para listar todos los usuarios
app.get('/api/users', isAuthenticated, async (_req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name, email, role FROM users');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ✅ Ruta protegida para obtener un usuario por email
app.get('/api/user/:email', isAuthenticated, async (req, res) => {
  const { email } = req.params;
  try {
    const [rows] = await db.query('SELECT id, name, email, role FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 🐛 Ruta pública de desarrollo para ver usuarios sin autenticación
if (IS_DEV) {
  app.get('/api/debug/users', async (_req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM users');
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error en modo debug' });
    }
  });
}

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en http://localhost:${PORT}`);
});
