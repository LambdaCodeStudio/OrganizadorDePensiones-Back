/**
 * Script para archivar tareas antiguas completadas
 * Uso: node scripts/archiveTasks.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CleaningTask = require('../models/cleaningTask');

// Función para archivar tareas completadas y verificadas que tengan más de X días
const archiveTasks = async (daysThreshold = 30) => {
  try {
    // Conectar a la base de datos
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Conectado a MongoDB');

    // Calcular la fecha límite (tareas anteriores a esta fecha serán archivadas)
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysThreshold);

    console.log(`Archivando tareas completadas anteriores a: ${thresholdDate.toISOString()}`);

    // Buscar tareas completadas y aprobadas que hayan terminado antes de la fecha límite
    const result = await CleaningTask.updateMany(
      { 
        completed: true,
        verificationStatus: 'approved',
        endDate: { $lt: thresholdDate },
        archived: { $ne: true }
      },
      { $set: { archived: true } }
    );

    console.log(`Tareas archivadas: ${result.modifiedCount}`);
    console.log(`Tareas que coincidieron con los criterios: ${result.matchedCount}`);

    // Desconectar de la base de datos
    await mongoose.disconnect();
    console.log('Desconectado de MongoDB');

    return result;

  } catch (error) {
    console.error('Error al archivar tareas:', error);
    
    // Asegurar que la conexión se cierre en caso de error
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('Desconectado de MongoDB después de error');
    }
    
    process.exit(1);
  }
};

// Si el script se ejecuta directamente
if (require.main === module) {
  // Obtener el umbral de días de los argumentos de línea de comandos o usar el valor predeterminado
  const daysThreshold = process.argv[2] ? parseInt(process.argv[2]) : 30;
  
  console.log(`Iniciando archivado de tareas más antiguas de ${daysThreshold} días...`);
  
  archiveTasks(daysThreshold)
    .then(() => {
      console.log('Proceso de archivado completado exitosamente');
      process.exit(0);
    })
    .catch(err => {
      console.error('Error en el proceso principal:', err);
      process.exit(1);
    });
}

module.exports = archiveTasks;