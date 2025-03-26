const mongoose = require('mongoose');

// Variables para cachear la conexión
let cachedConnection = null;

const connectDB = async () => {
  if (cachedConnection) {
    console.log('Usando conexión a MongoDB existente');
    return cachedConnection;
  }

  try {
    // Imprimir información de conexión (sin contraseña)
    const connectionString = process.env.MONGODB_URI;
    const sanitizedUri = connectionString.replace(
      /mongodb:\/\/([^:]+):([^@]+)@/,
      'mongodb://$1:****@'
    );
    console.log(`Intentando conectar a MongoDB: ${sanitizedUri}`);

    // Opciones para optimizar la conexión en entorno serverless
    const options = {
      // Establecer un conjunto de conexiones pequeño para entornos serverless
      maxPoolSize: 10,
      // Tiempo de vida de una conexión de socket inactiva
      socketTimeoutMS: 45000,
      // Tiempo de espera para selección de servidor
      serverSelectionTimeoutMS: 5000,
      // Habilitar logs detallados en desarrollo
      debug: process.env.NODE_ENV === 'development'
    };

    const connection = await mongoose.connect(process.env.MONGODB_URI, options);
    console.log('MongoDB conectado exitosamente');
    
    // Cachear la conexión
    cachedConnection = connection;
    return connection;
  } catch (error) {
    console.error('Error al conectar a MongoDB:');
    console.error(`Código: ${error.code}, Mensaje: ${error.message}`);
    
    // Mostrar detalles adicionales si está disponible
    if (error.reason) {
      console.error(`Razón: ${error.reason}`);
    }
    
    if (error.errorResponse) {
      console.error('Respuesta de error:', error.errorResponse);
    }

    throw error;
  }
};

module.exports = connectDB;