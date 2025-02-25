// controllers/cleaning.js
const CleaningTask = require('../models/cleaningTask');
const User = require('../models/user');

// Configuración de frecuencias por área
const taskFrequencies = {
  'Cortar el pasto': 'monthly',
  'Terraza y Escaleras': 'biweekly',
  // El resto de tareas serán semanales por defecto
};

const calculateEndDate = (startDate, frequency) => {
  const date = new Date(startDate);
  switch (frequency) {
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'biweekly':
      date.setDate(date.getDate() + 14);
      break;
    case 'weekly':
    default:
      date.setDate(date.getDate() + 7);
      break;
  }
  return date;
};

// Obtener usuarios y su disponibilidad
const getActiveUsers = async (req, res) => {
  try {
    const users = await User.find({}, '_id fullName availableNextWeek');
    res.json(users);
  } catch (error) {
    console.error('Error en getActiveUsers:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener todas las tareas activas
const getTasks = async (req, res) => {
  try {
    const tasks = await CleaningTask.find({
      endDate: { $gte: new Date() }
    }).populate('responsibles', 'fullName')
      .populate('temporaryResponsible', 'fullName')
      .populate('verifiers', 'fullName')
      .populate('verifications.verifier', 'fullName');
    
    res.json(tasks);
  } catch (error) {
    console.error('Error en getTasks:', error);
    res.status(500).json({ error: error.message });
  }
};

// Función mejorada de rotación de tareas
const rotateAssignments = async (req, res) => {
  try {
    console.log('Iniciando rotación de tareas con distribución inteligente');
    
    // 1. Obtener usuarios disponibles
    const availableUsers = await User.find({ availableNextWeek: true }, '_id fullName');
    console.log(`Usuarios disponibles: ${availableUsers.length}`);
    
    if (availableUsers.length < 2) {
      return res.status(400).json({ 
        error: 'Se necesitan al menos 2 usuarios disponibles para asignar todas las tareas correctamente' 
      });
    }

    // 2. Obtener historial de tareas previas (incluyendo las actuales)
    const taskHistory = await CleaningTask.find({})
      .populate('responsibles', '_id fullName')
      .populate('temporaryResponsible', '_id fullName')
      .sort({ endDate: -1 }) // Las más recientes primero
      .lean();
    
    console.log(`Historial de tareas obtenido: ${taskHistory.length} tareas`);

    // 3. Calcular métricas por usuario
    const userMetrics = calculateUserMetrics(taskHistory, availableUsers);
    console.log('Métricas de usuario calculadas');

    // 4. Definir áreas y sus características
    const areaConfig = [
      { area: 'Baño 1', peopleNeeded: 1, difficulty: 2 },
      { area: 'Baño 2', peopleNeeded: 1, difficulty: 2 },
      { area: 'Baño 3', peopleNeeded: 1, difficulty: 2 },
      { area: 'Terraza y Escaleras', peopleNeeded: 2, difficulty: 3 },
      { area: 'Orden de Cocina', peopleNeeded: 1, difficulty: 1 },
      { area: 'Cocina y Living', peopleNeeded: 2, difficulty: 4 },
      { area: 'Basura', peopleNeeded: 1, difficulty: 1 },
      { area: 'Cortar el pasto', peopleNeeded: 2, difficulty: 3 }
    ];

    // 5. Eliminar todas las tareas actuales
    await CleaningTask.deleteMany({});
    console.log('Tareas anteriores eliminadas');

    // 6. Crear nuevas tareas con distribución inteligente
    const now = new Date();
    let newTasks = [];

    // Obtener la carga de trabajo objetivo por usuario
    const totalDifficulty = areaConfig.reduce((sum, area) => sum + (area.difficulty * area.peopleNeeded), 0);
    const targetWorkloadPerUser = totalDifficulty / availableUsers.length;
    console.log(`Carga objetivo por usuario: ${targetWorkloadPerUser.toFixed(2)}`);

    // Reiniciar métricas de carga de trabajo actual
    availableUsers.forEach(user => {
      userMetrics[user._id] = userMetrics[user._id] || {};
      userMetrics[user._id].currentWorkload = 0;
    });

    // Asignar tareas por prioridad (primero áreas más difíciles)
    const prioritizedAreas = [...areaConfig].sort((a, b) => b.difficulty - a.difficulty);

    for (const areaInfo of prioritizedAreas) {
      const frequency = taskFrequencies[areaInfo.area] || 'weekly';
      const endDate = calculateEndDate(now, frequency);
      
      console.log(`Asignando tarea para: ${areaInfo.area} (dificultad: ${areaInfo.difficulty})`);
      
      // Seleccionar responsables óptimos para esta área
      const responsibles = selectResponsiblesForArea(
        areaInfo, 
        availableUsers, 
        userMetrics,
        targetWorkloadPerUser
      );
      
      // Actualizar las cargas de trabajo de los usuarios asignados
      responsibles.forEach(userId => {
        userMetrics[userId].currentWorkload += areaInfo.difficulty;
        userMetrics[userId].tasksAssigned = (userMetrics[userId].tasksAssigned || 0) + 1;
        userMetrics[userId].lastAssignedAreas = userMetrics[userId].lastAssignedAreas || {};
        userMetrics[userId].lastAssignedAreas[areaInfo.area] = now;
      });

      // Seleccionar verificadores (intentando evitar a los responsables)
      const verifiers = selectVerifiers(responsibles, availableUsers, userMetrics);

      // Crear la nueva tarea
      newTasks.push(new CleaningTask({
        area: areaInfo.area,
        frequency,
        responsibles,
        startDate: now,
        endDate,
        verifiers
      }));
    }

    if (newTasks.length > 0) {
      await CleaningTask.insertMany(newTasks);
      console.log(`${newTasks.length} nuevas tareas creadas`);
    }

    // Log de distribución final
    logFinalDistribution(userMetrics, availableUsers);

    // Obtener y devolver las tareas actualizadas
    const populatedTasks = await CleaningTask.find()
      .populate('responsibles', 'fullName')
      .populate('verifiers', 'fullName')
      .populate('temporaryResponsible', 'fullName')
      .populate('verifications.verifier', 'fullName');

    return res.json(populatedTasks);

  } catch (error) {
    console.error('Error en rotateAssignments:', error);
    return res.status(500).json({ 
      error: 'Error al rotar las asignaciones',
      details: error.message 
    });
  }
};

// Función para calcular métricas por usuario
function calculateUserMetrics(taskHistory, availableUsers) {
  const metrics = {};
  
  // Inicializar métricas para todos los usuarios disponibles
  availableUsers.forEach(user => {
    metrics[user._id] = {
      totalHistoricalTasks: 0,
      completedTasks: 0,
      incompleteOrRejectedTasks: 0,
      completionRate: 1, // 100% por defecto
      lastAssignedAreas: {}, // Última vez que se asignó cada área
      areaAssignmentCounts: {}, // Número de veces que cada área fue asignada
      preferences: {} // Podría usarse en un futuro para preferencias de los usuarios
    };
  });

  // Analizar el historial de tareas
  taskHistory.forEach(task => {
    const wasCompleted = task.completed && task.verificationStatus === 'approved';
    const wasRejected = task.completed && task.verificationStatus === 'rejected';
    
    // Registrar métricas para cada responsable
    task.responsibles.forEach(user => {
      const userId = user._id.toString();
      
      // Omitir usuarios que no están disponibles actualmente
      if (!metrics[userId]) return;
      
      metrics[userId].totalHistoricalTasks++;
      
      if (wasCompleted) {
        metrics[userId].completedTasks++;
      } else if (wasRejected || task.completed === false) {
        metrics[userId].incompleteOrRejectedTasks++;
      }
      
      // Actualizar última asignación de esta área
      if (!metrics[userId].lastAssignedAreas[task.area] || 
          new Date(task.endDate) > new Date(metrics[userId].lastAssignedAreas[task.area])) {
        metrics[userId].lastAssignedAreas[task.area] = task.endDate;
      }
      
      // Incrementar contador de asignaciones para esta área
      metrics[userId].areaAssignmentCounts[task.area] = 
        (metrics[userId].areaAssignmentCounts[task.area] || 0) + 1;
    });
    
    // También considerar responsables temporales
    if (task.temporaryResponsible) {
      const tempUserId = task.temporaryResponsible._id.toString();
      if (metrics[tempUserId]) {
        metrics[tempUserId].totalHistoricalTasks++;
        
        if (wasCompleted) {
          metrics[tempUserId].completedTasks++;
        } else if (wasRejected || task.completed === false) {
          metrics[tempUserId].incompleteOrRejectedTasks++;
        }
      }
    }
  });
  
  // Calcular tasas de completado
  Object.keys(metrics).forEach(userId => {
    const userMetrics = metrics[userId];
    const totalEvaluable = userMetrics.completedTasks + userMetrics.incompleteOrRejectedTasks;
    
    if (totalEvaluable > 0) {
      userMetrics.completionRate = userMetrics.completedTasks / totalEvaluable;
    }
  });
  
  return metrics;
}

// Función para seleccionar responsables óptimos para un área
function selectResponsiblesForArea(areaInfo, availableUsers, userMetrics, targetWorkload) {
  const selectedResponsibles = [];
  const area = areaInfo.area;
  const peopleNeeded = areaInfo.peopleNeeded;
  
  // Crear una lista temporal de usuarios disponibles con puntajes calculados
  const scoredUsers = availableUsers.map(user => {
    const userId = user._id.toString();
    const metrics = userMetrics[userId];
    
    // Factores a considerar:
    // 1. ¿Cuándo fue la última vez que el usuario hizo esta tarea? (más tiempo = mejor)
    const daysSinceLastAssignment = metrics.lastAssignedAreas[area] 
      ? Math.floor((new Date() - new Date(metrics.lastAssignedAreas[area])) / (1000 * 60 * 60 * 24)) 
      : 365; // Si nunca ha hecho esta tarea, alto puntaje
    
    // 2. ¿Cuántas veces ha hecho esta tarea en total? (menos = mejor)
    const areaAssignmentCount = metrics.areaAssignmentCounts[area] || 0;
    
    // 3. Carga de trabajo actual vs. objetivo (menos carga = mejor)
    const workloadDifference = targetWorkload - (metrics.currentWorkload || 0);
    
    // 4. Tasa de completado de tareas (mayor tasa = mejor)
    const completionRateBonus = metrics.completionRate * 3; // Factor de peso para la tasa de completado
    
    // 5. Número total de tareas históricas (menos = mejor)
    const totalTasksRatio = metrics.totalHistoricalTasks / 
      (Math.max(...Object.values(userMetrics).map(m => m.totalHistoricalTasks || 0)) || 1);
    
    // Calcular puntaje final (mayor = mejor candidato)
    const score = 
      (daysSinceLastAssignment * 0.2) + // Factor de tiempo desde última asignación
      ((10 - areaAssignmentCount) * 0.2) + // Factor de frecuencia de asignación
      (workloadDifference * 0.3) + // Factor de balance de carga 
      (completionRateBonus * 0.2) + // Factor de tasa de completado
      ((1 - totalTasksRatio) * 0.1); // Factor de total histórico
      
    return {
      user,
      userId: userId,
      score
    };
  });
  
  // Ordenar usuarios por puntaje (descendente)
  scoredUsers.sort((a, b) => b.score - a.score);
  
  // Seleccionar los mejores candidatos
  for (let i = 0; i < peopleNeeded; i++) {
    if (scoredUsers.length > 0) {
      const selected = scoredUsers.shift();
      selectedResponsibles.push(selected.userId);
    }
  }
  
  console.log(`Asignados para ${area}: ${selectedResponsibles.length} usuarios`);
  return selectedResponsibles;
}

// Función para seleccionar verificadores
function selectVerifiers(responsibles, availableUsers, userMetrics) {
  // Filtrar usuarios disponibles excluyendo a los responsables
  const potentialVerifiers = availableUsers.filter(user => 
    !responsibles.includes(user._id.toString())
  );
  
  // Si no hay suficientes usuarios disponibles, usar todos los usuarios
  if (potentialVerifiers.length < 3) {
    const allUserIds = availableUsers.map(user => user._id.toString());
    // Ordenar por tasa de completado (primero los más confiables)
    allUserIds.sort((a, b) => 
      (userMetrics[b]?.completionRate || 0) - (userMetrics[a]?.completionRate || 0)
    );
    return allUserIds.slice(0, Math.min(3, allUserIds.length));
  }
  
  // Ordenar verificadores por tasa de completado (primero los más confiables)
  potentialVerifiers.sort((a, b) => 
    (userMetrics[b._id]?.completionRate || 0) - (userMetrics[a._id]?.completionRate || 0)
  );
  
  // Seleccionar hasta 3 verificadores con la mejor tasa de completado
  return potentialVerifiers
    .slice(0, 3)
    .map(user => user._id.toString());
}

// Función para registrar distribución final
function logFinalDistribution(userMetrics, availableUsers) {
  console.log('----- Distribución final de tareas -----');
  availableUsers.forEach(user => {
    const metrics = userMetrics[user._id.toString()];
    console.log(`${user.fullName}: ${metrics.tasksAssigned || 0} tareas asignadas, carga: ${metrics.currentWorkload?.toFixed(2) || 0}`);
  });
  console.log('----------------------------------------');
}

// Marcar tarea como completada
const markAsCompleted = async (req, res) => {
  try {
    const taskId = req.params.id;
    const { completed } = req.body;
    
    // Verificar si la tarea existe
    const task = await CleaningTask.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    // Verificar si el usuario tiene permiso para marcar la tarea
    const isResponsible = task.responsibles.some(r => r.toString() === req.user.id) ||
                         (task.temporaryResponsible && task.temporaryResponsible.toString() === req.user.id);
    
    if (!isResponsible && !req.user.isAdmin) {
      return res.status(403).json({ error: 'No tienes permiso para actualizar esta tarea' });
    }

    // Si la tarea está siendo marcada como incompleta, resetear también el estado de verificación
    const updateData = completed ? {
      completed,
      completedAt: new Date(),
      verificationStatus: 'pending'
    } : {
      completed,
      completedAt: null,
      verificationStatus: 'pending',
      verifications: [] // Limpiar verificaciones anteriores
    };

    const updatedTask = await CleaningTask.findByIdAndUpdate(
      taskId,
      { $set: updateData },
      { 
        new: true,
        runValidators: true
      }
    ).populate('responsibles', 'fullName')
     .populate('temporaryResponsible', 'fullName')
     .populate('verifiers', 'fullName')
     .populate('verifications.verifier', 'fullName');

    if (!updatedTask) {
      return res.status(404).json({ error: 'Tarea no encontrada después de la actualización' });
    }

    res.json(updatedTask);
  } catch (error) {
    console.error('Error en markAsCompleted:', error);
    res.status(500).json({ 
      error: 'Error al actualizar el estado de la tarea',
      details: error.message 
    });
  }
};

// Cambiar responsable de tarea
const changeTaskResponsible = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { responsibleId } = req.body;

    const task = await CleaningTask.findByIdAndUpdate(
      taskId,
      { 
        $set: { 
          temporaryResponsible: responsibleId 
        } 
      },
      { 
        new: true 
      }
    ).populate('responsibles', 'fullName')
      .populate('temporaryResponsible', 'fullName')
      .populate('verifiers', 'fullName')
      .populate('verifications.verifier', 'fullName');

    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    res.json(task);
  } catch (error) {
    console.error('Error en changeTaskResponsible:', error);
    res.status(500).json({ error: error.message });
  }
};

const respondToSwapRequest = async (req, res) => {
  try {
    const { taskId, swapRequestId, accept } = req.body;
    const userId = req.user.id;

    const task = await CleaningTask.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    const swapRequest = task.swapRequests.id(swapRequestId);
    if (!swapRequest) {
      return res.status(404).json({ error: 'Solicitud de intercambio no encontrada' });
    }

    // Verificar que el usuario es responsable de la tarea
    const isResponsible = task.responsibles.some(r => r.toString() === userId) ||
                         (task.temporaryResponsible && task.temporaryResponsible.toString() === userId);

    if (!isResponsible) {
      return res.status(403).json({ error: 'No tienes permiso para responder a esta solicitud' });
    }

    if (accept) {
      // Realizar el intercambio
      await swapTasks(task._id, swapRequest.targetTask);
      swapRequest.status = 'accepted';
    } else {
      swapRequest.status = 'rejected';
    }

    await task.save();

    const populatedTask = await CleaningTask.findById(task._id)
      .populate('responsibles', 'fullName')
      .populate('temporaryResponsible', 'fullName')
      .populate('swapRequests.requestedBy', 'fullName')
      .populate('swapRequests.targetTask');

    res.json(populatedTask);
  } catch (error) {
    console.error('Error en respondToSwapRequest:', error);
    res.status(500).json({ error: error.message });
  }
};

// Intercambiar tareas
const swapTasks = async (req, res) => {
  try {
    const { task1Id, task2Id } = req.body;
    const userId = req.user.id;

    // Obtener ambas tareas
    const task1 = await CleaningTask.findById(task1Id);
    const task2 = await CleaningTask.findById(task2Id);

    if (!task1 || !task2) {
      return res.status(404).json({ error: 'Una o ambas tareas no encontradas' });
    }

    // Verificar que el usuario es responsable de al menos una de las tareas
    const isResponsibleForTask1 = task1.responsibles.some(r => r.toString() === userId) ||
                                 (task1.temporaryResponsible && task1.temporaryResponsible.toString() === userId);
    const isResponsibleForTask2 = task2.responsibles.some(r => r.toString() === userId) ||
                                 (task2.temporaryResponsible && task2.temporaryResponsible.toString() === userId);

    if (!isResponsibleForTask1 && !isResponsibleForTask2) {
      return res.status(403).json({ 
        error: 'No tienes permiso para intercambiar estas tareas' 
      });
    }

    // Verificar que las tareas no estén completadas
    if (task1.completed || task2.completed) {
      return res.status(400).json({ 
        error: 'No se pueden intercambiar tareas que ya están completadas' 
      });
    }

    // Intercambiar responsables
    const temp = task1.responsibles;
    task1.responsibles = task2.responsibles;
    task2.responsibles = temp;

    // Limpiar responsables temporales si existen
    task1.temporaryResponsible = undefined;
    task2.temporaryResponsible = undefined;

    // Guardar los cambios
    await Promise.all([task1.save(), task2.save()]);

    // Poblar y devolver las tareas actualizadas
    const updatedTask1 = await CleaningTask.findById(task1Id)
      .populate('responsibles', 'fullName')
      .populate('temporaryResponsible', 'fullName')
      .populate('verifiers', 'fullName')
      .populate('verifications.verifier', 'fullName');

    const updatedTask2 = await CleaningTask.findById(task2Id)
      .populate('responsibles', 'fullName')
      .populate('temporaryResponsible', 'fullName')
      .populate('verifiers', 'fullName')
      .populate('verifications.verifier', 'fullName');

    res.json([updatedTask1, updatedTask2]);
  } catch (error) {
    console.error('Error en swapTasks:', error);
    res.status(500).json({ error: error.message });
  }
};

// Verificar tarea
const verifyTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { approved, comment } = req.body;
    const verifierId = req.user.id;

    const task = await CleaningTask.findById(taskId)
      .populate('responsibles', 'fullName')
      .populate('verifiers', 'fullName')
      .populate('verifications.verifier', 'fullName');

    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    // Verificar si la tarea está marcada como completada
    if (!task.completed) {
      return res.status(400).json({ error: 'La tarea aún no está marcada como completada' });
    }

    // Verificar si el usuario es verificador de esta tarea
    if (!task.verifiers.some(v => v._id.toString() === verifierId)) {
      return res.status(403).json({ error: 'No eres verificador de esta tarea' });
    }

    // Verificar si ya emitió su verificación
    if (task.verifications.some(v => v.verifier.toString() === verifierId)) {
      return res.status(400).json({ error: 'Ya has verificado esta tarea' });
    }

    // Agregar la verificación
    task.verifications.push({
      verifier: verifierId,
      approved,
      comment,
      verifiedAt: new Date()
    });

    // Actualizar estado de verificación
    const totalVerifiers = task.verifiers.length;
    const totalVerifications = task.verifications.length;
    const approvedCount = task.verifications.filter(v => v.approved).length;
    const rejectedCount = task.verifications.filter(v => !v.approved).length;

    if (totalVerifications === totalVerifiers) {
      // Si todas las verificaciones están completas
      task.verificationStatus = approvedCount > rejectedCount ? 'approved' : 'rejected';
    } else {
      // Si aún faltan verificaciones
      if (approvedCount > rejectedCount) {
        task.verificationStatus = 'approved';
      } else if (rejectedCount > approvedCount) {
        task.verificationStatus = 'rejected';
      } else {
        task.verificationStatus = 'in_progress';
      }
    }

    await task.save();

    // Poblar los datos de la tarea actualizada
    await task.populate('responsibles', 'fullName');
    await task.populate('verifiers', 'fullName');
    await task.populate('verifications.verifier', 'fullName');

    res.json(task);
  } catch (error) {
    console.error('Error en verifyTask:', error);
    res.status(500).json({ error: error.message });
  }
};

// Actualizar disponibilidad de usuario
const updateUserAvailability = async (req, res) => {
  try {
    const { userId } = req.params;
    const { available } = req.body;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
 
    // Verificar permisos
    if (!req.user.isAdmin && req.user.id !== userId) {
      return res.status(403).json({ error: 'No tienes permiso para actualizar este usuario' });
    }
 
    user.availableNextWeek = available;
    await user.save();
 
    res.json(user);
  } catch (error) {
    console.error('Error en updateUserAvailability:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener solicitudes de intercambio
const getSwapRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    // Buscar tareas donde:
    // 1. El usuario es responsable de la tarea solicitada (debe aprobar)
    // 2. El usuario es quien solicitó el intercambio (para ver sus solicitudes pendientes)
    const tasks = await CleaningTask.find({
      $or: [
        {
          $and: [
            { 
              $or: [
                { 'responsibles': userId },
                { 'temporaryResponsible': userId }
              ]
            },
            { 'swapRequests.status': 'pending' }
          ]
        },
        {
          'swapRequests': {
            $elemMatch: {
              requestedBy: userId,
              status: 'pending'
            }
          }
        }
      ]
    }).populate('swapRequests.requestedBy', 'fullName')
      .populate({
        path: 'swapRequests.targetTask',
        populate: {
          path: 'responsibles',
          select: 'fullName'
        }
      })
      .populate('responsibles', 'fullName')
      .populate('temporaryResponsible', 'fullName');

    // Filtrar y formatear las solicitudes
    const swapRequests = tasks.reduce((requests, task) => {
      const taskRequests = task.swapRequests
        .filter(req => {
          if (req.status !== 'pending') return false;
          
          // Incluir la solicitud si:
          // 1. El usuario actual es responsable de la tarea solicitada (debe aprobar)
          // 2. El usuario es quien hizo la solicitud (para ver sus propias solicitudes)
          const isTaskResponsible = task.responsibles.some(r => r._id.toString() === userId) ||
                                  (task.temporaryResponsible && task.temporaryResponsible._id.toString() === userId);
          const isRequestor = req.requestedBy._id.toString() === userId;
          
          return isTaskResponsible !== isRequestor; // Solo mostrar al usuario opuesto
        })
        .map(req => ({
          _id: req._id,
          requester: req.requestedBy,
          requestedTask: task,
          offeredTask: req.targetTask,
          status: req.status,
          createdAt: req.createdAt,
          isOwnRequest: req.requestedBy._id.toString() === userId
        }));

      return [...requests, ...taskRequests];
    }, []);

    res.json(swapRequests);
  } catch (error) {
    console.error('Error en getSwapRequests:', error);
    res.status(500).json({ error: error.message });
  }
};

// Crear solicitud de intercambio
const createSwapRequest = async (req, res) => {
  try {
    const { requestedTaskId, offeredTaskId } = req.body;
    const userId = req.user.id;

    // Verificar que ambas tareas existen
    const [requestedTask, offeredTask] = await Promise.all([
      CleaningTask.findById(requestedTaskId),
      CleaningTask.findById(offeredTaskId)
    ]);

    if (!requestedTask || !offeredTask) {
      return res.status(404).json({ error: 'Una o ambas tareas no encontradas' });
    }

    // Verificar que el usuario es responsable de la tarea ofrecida
    const isResponsible = offeredTask.responsibles.some(r => r.toString() === userId) ||
                         (offeredTask.temporaryResponsible && offeredTask.temporaryResponsible.toString() === userId);

    if (!isResponsible) {
      return res.status(403).json({ error: 'No tienes permiso para ofrecer esta tarea' });
    }

    // Verificar si ya existe una solicitud pendiente para estas tareas
    const existingRequest = requestedTask.swapRequests.find(req => 
      req.status === 'pending' && 
      req.targetTask.toString() === offeredTaskId &&
      req.requestedBy.toString() === userId
    );

    if (existingRequest) {
      return res.status(400).json({ error: 'Ya existe una solicitud de intercambio pendiente para estas tareas' });
    }

    // Verificar si el usuario tiene demasiadas solicitudes pendientes (por ejemplo, máximo 3)
    const pendingRequests = await CleaningTask.countDocuments({
      'swapRequests': {
        $elemMatch: {
          requestedBy: userId,
          status: 'pending'
        }
      }
    });

    if (pendingRequests >= 3) {
      return res.status(400).json({ error: 'Ya tienes demasiadas solicitudes de intercambio pendientes' });
    }

    // Agregar la solicitud de intercambio
    requestedTask.swapRequests.push({
      requestedBy: userId,
      targetTask: offeredTaskId,
      status: 'pending',
      createdAt: new Date()
    });

    await requestedTask.save();

    // Poblar y devolver la tarea actualizada
    await requestedTask.populate('swapRequests.requestedBy', 'fullName');
    await requestedTask.populate('swapRequests.targetTask');

    res.json(requestedTask);
  } catch (error) {
    console.error('Error en createSwapRequest:', error);
    res.status(500).json({ error: error.message });
  }
};

// Aceptar solicitud de intercambio
const acceptSwapRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    // Encontrar la tarea con la solicitud de intercambio
    const task = await CleaningTask.findOne({
      'swapRequests._id': requestId
    });

    if (!task) {
      return res.status(404).json({ error: 'Solicitud de intercambio no encontrada' });
    }

    const swapRequest = task.swapRequests.id(requestId);
    if (!swapRequest || swapRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Solicitud de intercambio no válida' });
    }

    // Verificar que el usuario es responsable de la tarea solicitada
    const isResponsible = task.responsibles.some(r => r.toString() === userId) ||
                         (task.temporaryResponsible && task.temporaryResponsible.toString() === userId);

    if (!isResponsible) {
      return res.status(403).json({ error: 'No tienes permiso para aceptar esta solicitud' });
    }

    // Realizar el intercambio
    const offeredTask = await CleaningTask.findById(swapRequest.targetTask);
    if (!offeredTask) {
      return res.status(404).json({ error: 'Tarea ofrecida no encontrada' });
    }

    // Intercambiar responsables
    const tempResponsibles = task.responsibles;
    task.responsibles = offeredTask.responsibles;
    offeredTask.responsibles = tempResponsibles;

    // Limpiar responsables temporales
    task.temporaryResponsible = undefined;
    offeredTask.temporaryResponsible = undefined;

    // Marcar la solicitud como aceptada
    swapRequest.status = 'accepted';

    // Guardar los cambios
    await Promise.all([task.save(), offeredTask.save()]);

    // Devolver las tareas actualizadas
    await task.populate('responsibles', 'fullName');
    await task.populate('swapRequests.requestedBy', 'fullName');
    await task.populate('swapRequests.targetTask');

    res.json(task);
  } catch (error) {
    console.error('Error en acceptSwapRequest:', error);
    res.status(500).json({ error: error.message });
  }
};

// Rechazar solicitud de intercambio
const rejectSwapRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    // Encontrar la tarea con la solicitud de intercambio
    const task = await CleaningTask.findOne({
      'swapRequests._id': requestId
    });

    if (!task) {
      return res.status(404).json({ error: 'Solicitud de intercambio no encontrada' });
    }

    const swapRequest = task.swapRequests.id(requestId);
    if (!swapRequest || swapRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Solicitud de intercambio no válida' });
    }

    // Verificar que el usuario es responsable de la tarea solicitada
    const isResponsible = task.responsibles.some(r => r.toString() === userId) ||
                         (task.temporaryResponsible && task.temporaryResponsible.toString() === userId);

    if (!isResponsible) {
      return res.status(403).json({ error: 'No tienes permiso para rechazar esta solicitud' });
    }

    // Marcar la solicitud como rechazada
    swapRequest.status = 'rejected';
    await task.save();

    // Devolver la tarea actualizada
    await task.populate('responsibles', 'fullName');
    await task.populate('swapRequests.requestedBy', 'fullName');
    await task.populate('swapRequests.targetTask');

    res.json(task);
  } catch (error) {
    console.error('Error en rejectSwapRequest:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getTasks,
  rotateAssignments,
  markAsCompleted,
  verifyTask,
  getActiveUsers,
  updateUserAvailability,
  changeTaskResponsible,
  swapTasks,
  createSwapRequest,
  getSwapRequests,
  respondToSwapRequest,
  rejectSwapRequest,
  acceptSwapRequest
};