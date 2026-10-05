import { Router } from 'express';
import {
    createHabit,
    createHabitFromPlan,
    getAllHabits,
    getHabitById,
    updateHabit,
    updateSessionTitle,
    deleteHabit,
    markHabitCompletion,
    getHabitsForDate,
    toggleStep,
    setHabitValue,
    addPause,
    endPause,
    removePause,
    addRestDay,
    removeRestDay,
} from '@controllers/habitController';
import { createAIHabit } from '@controllers/aiHabitController';
import { verifyTokenMiddleware } from '@middlewares/auth';
import { aiLimiter } from '@middlewares/rateLimit';
import { validate } from '@middlewares/validate';
import {
    addPauseSchema,
    addRestDaySchema,
    createAIHabitSchema,
    createHabitFromPlanSchema,
    createHabitSchema,
    endPauseSchema,
    habitParamsSchema,
    habitsForDateQuerySchema,
    markCompletionSchema,
    pauseParamsSchema,
    restDayParamsSchema,
    setValueSchema,
    stepParamsSchema,
    toggleStepSchema,
    updateHabitSchema,
    updateSessionTitleSchema,
} from '@validation/habitSchemas';

const router = Router();

// Створення звички вручну
router.post('/', verifyTokenMiddleware, validate({ body: createHabitSchema }), createHabit);

// Взяття плану з бібліотеки. Окремий маршрут, а не опційний planId у POST /:
// інакше createHabitSchema стає union з умовно обов'язковими полями, і тип із
// z.infer перестає бути придатним.
router.post('/from-plan', verifyTokenMiddleware, validate({ body: createHabitFromPlanSchema }), createHabitFromPlan);

// Створення звички через AI (ліміт після авторизації — ключ рахується по користувачу)
router.post('/ai', verifyTokenMiddleware, aiLimiter, validate({ body: createAIHabitSchema }), createAIHabit);

// Отримання звичок на конкретну дату (основний ендпоінт для щоденного відображення)
router.get('/daily', verifyTokenMiddleware, validate({ query: habitsForDateQuerySchema }), getHabitsForDate);

// Отримання всіх звичок (залишаємо для загального огляду)
router.get('/', verifyTokenMiddleware, getAllHabits);

// Операції з конкретною звичкою
router.get('/:id', verifyTokenMiddleware, validate({ params: habitParamsSchema }), getHabitById);
router.put('/:id', verifyTokenMiddleware, validate({ params: habitParamsSchema, body: updateHabitSchema }), updateHabit);
router.delete('/:id', verifyTokenMiddleware, validate({ params: habitParamsSchema }), deleteHabit);

// Перейменування заняття програми (не календарного дня: з паузами й вихідними вони розходяться)
router.patch('/:id/day', verifyTokenMiddleware, validate({ params: habitParamsSchema, body: updateSessionTitleSchema }), updateSessionTitle);

// Відмітка виконання
router.patch('/:id/complete', verifyTokenMiddleware, validate({ params: habitParamsSchema, body: markCompletionSchema }), markHabitCompletion);

// Кількість за день, для звичок із ціллю
router.patch('/:id/value', verifyTokenMiddleware, validate({ params: habitParamsSchema, body: setValueSchema }), setHabitValue);

// Оновлення кроку (переключення статусу)
router.patch('/:id/steps/:stepId', verifyTokenMiddleware, validate({ params: stepParamsSchema, body: toggleStepSchema }), toggleStep);

// Пауза: відрізок днів, які не рахуються
router.post('/:id/pauses', verifyTokenMiddleware, validate({ params: habitParamsSchema, body: addPauseSchema }), addPause);
router.patch('/:id/pauses/:pauseId', verifyTokenMiddleware, validate({ params: pauseParamsSchema, body: endPauseSchema }), endPause);
router.delete('/:id/pauses/:pauseId', verifyTokenMiddleware, validate({ params: pauseParamsSchema }), removePause);

// Вихідний: один день, який не рахується (лише для щоденних звичок)
router.post('/:id/rest-days', verifyTokenMiddleware, validate({ params: habitParamsSchema, body: addRestDaySchema }), addRestDay);
router.delete('/:id/rest-days/:date', verifyTokenMiddleware, validate({ params: restDayParamsSchema }), removeRestDay);

export default router;
