const router = require('express').Router();
const {
  getTasks,
  rotateAssignments,
  markAsCompleted,
  verifyTask,
  getActiveUsers,
  changeTaskResponsible,
  getSwapRequests,
  createSwapRequest,
  acceptSwapRequest,
  rejectSwapRequest,
  updateUserAvailability
} = require('../controllers/cleaning');
const auth = require('../middleware/auth');

// Rutas de tareas básicas
router.get('/tasks', auth, getTasks);
router.get('/active-users', auth, getActiveUsers);
router.post('/rotate-assignments', auth, rotateAssignments);
router.patch('/tasks/:id/complete', auth, markAsCompleted);
router.patch('/tasks/:taskId/responsible', auth, changeTaskResponsible);
router.post('/tasks/:taskId/verify', auth, verifyTask);

// Rutas de intercambio
router.get('/swap-requests', auth, getSwapRequests);
router.post('/swap-requests', auth, createSwapRequest);
router.post('/swap-requests/:requestId/accept', auth, acceptSwapRequest);
router.post('/swap-requests/:requestId/reject', auth, rejectSwapRequest);

// Ruta de disponibilidad
router.post('/users/:userId/availability', auth, updateUserAvailability);

module.exports = router;