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

// Asignar verificadores con lógica adaptativa
const assignVerifiers = (allUsers, taskResponsibles) => {
  let availableVerifiers;
  
  if (allUsers.length <= 3) {
    // Si hay 3 o menos usuarios, todos pueden ser verificadores
    availableVerifiers = allUsers;
  } else {
    // Si hay más de 3 usuarios, intentar evitar que los responsables sean verificadores
    availableVerifiers = allUsers.filter(user => 
      !taskResponsibles.some(responsible => 
        responsible.toString() === user._id.toString()
      )
    );

    // Si no hay suficientes verificadores disponibles, usar todos los usuarios
    if (availableVerifiers.length < 3) {
      availableVerifiers = allUsers;
    }
  }

  // Asegurar que tengamos al menos un verificador
  const numVerifiers = Math.min(3, allUsers.length);
  const shuffled = [...availableVerifiers].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, numVerifiers).map(user => user._id);
};

// Rotar asignaciones
const rotateAssignments = async (req, res) => {
  try {
    console.log('Iniciando rotación de tareas');
    
    const availableUsers = await User.find({ availableNextWeek: true }, '_id fullName');
    console.log('Usuarios disponibles encontrados:', availableUsers);
    
    if (availableUsers.length < 2) {
      return res.status(400).json({ 
        error: 'Se necesitan al menos 2 usuarios disponibles para asignar todas las tareas correctamente' 
      });
    }

    // Obtener tareas actuales
    const currentTasks = await CleaningTask.find();
    const now = new Date();

    const areaRequirements = [
      { area: 'Baño 1', peopleNeeded: 1 },
      { area: 'Baño 2', peopleNeeded: 1 },
      { area: 'Baño 3', peopleNeeded: 1 },
      { area: 'Terraza y Escaleras', peopleNeeded: 1 },
      { area: 'Orden de Cocina', peopleNeeded: 1 },
      { area: 'Cocina y Living', peopleNeeded: 2 },
      { area: 'Basura', peopleNeeded: 1 },
      { area: 'Cortar el pasto', peopleNeeded: 2 }
    ];

    const totalPeopleNeeded = areaRequirements.reduce((sum, area) => sum + area.peopleNeeded, 0);
    const assignmentMultiplier = Math.ceil(totalPeopleNeeded / availableUsers.length);
    console.log(`Cada usuario necesitará cubrir aproximadamente ${assignmentMultiplier} tareas`);

    let newTasks = [];
    let currentUserIndex = 0;

    // Primero, eliminar todas las tareas existentes
    await CleaningTask.deleteMany({});

    for (const areaConfig of areaRequirements) {
      const frequency = taskFrequencies[areaConfig.area] || 'weekly';
      const endDate = calculateEndDate(now, frequency);
      
      // Asignar responsables
      const responsibles = [];
      for (let i = 0; i < areaConfig.peopleNeeded; i++) {
        responsibles.push(availableUsers[currentUserIndex % availableUsers.length]._id);
        currentUserIndex++;
      }

      // Asignar verificadores evitando los responsables si es posible
      let availableVerifiers = availableUsers.filter(user => 
        !responsibles.some(r => r.toString() === user._id.toString())
      );

      if (availableVerifiers.length < 1) {
        availableVerifiers = availableUsers;
      }

      const numVerifiers = Math.min(3, Math.max(1, availableVerifiers.length));
      const verifiers = availableVerifiers
        .sort(() => Math.random() - 0.5)
        .slice(0, numVerifiers)
        .map(user => user._id);

      newTasks.push(new CleaningTask({
        area: areaConfig.area,
        frequency,
        responsibles,
        startDate: now,
        endDate,
        verifiers
      }));
    }

    // Insertar todas las nuevas tareas
    if (newTasks.length > 0) {
      await CleaningTask.insertMany(newTasks);
    }

    // Obtener todas las tareas actualizadas
    const populatedTasks = await CleaningTask.find()
      .populate('responsibles', 'fullName')
      .populate('verifiers', 'fullName')
      .populate('temporaryResponsible', 'fullName')
      .populate('verifications.verifier', 'fullName');

    res.json(populatedTasks);

  } catch (error) {
    console.error('Error en rotateAssignments:', error);
    res.status(500).json({ 
      error: 'Error al rotar las asignaciones',
      details: error.message 
    });
  }
};

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
    const { userId, available } = req.body;
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