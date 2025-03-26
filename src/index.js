require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/db');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
const corsOptions = require('./config/cors');
const MongoStore = require('connect-mongo');

// Variable para seguir el estado de la conexión a la DB
let isConnected = false;

const app = express();

// Configurar Express para confiar en los proxys de Vercel
// Esto es necesario para que express-rate-limit funcione correctamente
app.set('trust proxy', 1);

// Middlewares básicos
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Seguridad
app.use(helmet({
  contentSecurityPolicy: true,
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: true,
  dnsPrefetchControl: true,
  frameguard: true,
  hidePoweredBy: true,
  hsts: true,
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: true,
  referrerPolicy: true,
  xssFilter: true
}));

app.use(mongoSanitize());
app.use(hpp());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite de 100 peticiones por ventana
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// Cookies y Session
const sessionConfig = {
  secret: process.env.SESSION_SECRET,
  name: 'sessionId',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60 // 1 día
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: parseInt(process.env.SESSION_MAXAGE) || 3600000
  }
};

// En producción, habilitar proxy para las cookies
if (process.env.NODE_ENV === 'production') {
  sessionConfig.cookie.secure = true;
  sessionConfig.cookie.sameSite = 'none';
}

app.use(session(sessionConfig));

// Headers adicionales
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Middleware para conectar a la DB en entorno serverless
app.use(async (req, res, next) => {
  // Solo conecta si no hay conexión activa
  if (!isConnected) {
    try {
      await connectDB();
      isConnected = true;
    } catch (error) {
      console.error('Error al conectar a MongoDB:', error);
      return res.status(500).json({ error: 'Error al conectar a la base de datos' });
    }
  }
  return next();
});

// Rutas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/cleaning', require('./routes/cleaning'));

// Ruta de control de salud
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manejador de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error('Error en servidor:', err);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 4000;

// Solo inicia el servidor si no estamos en serverless (Vercel)
if (process.env.NODE_ENV !== 'production') {
  const startServer = async () => {
    try {
      await connectDB();
      isConnected = true;
      app.listen(PORT, () => console.log(`Servidor ejecutándose en puerto ${PORT}`));
    } catch (err) {
      console.error('Error al iniciar servidor:', err);
      process.exit(1);
    }
  };
  
  startServer();
}

// Exportar para entorno serverless
module.exports = app;