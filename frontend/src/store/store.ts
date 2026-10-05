import { combineReducers, configureStore } from '@reduxjs/toolkit';
import authReducer from '@store/authSlice';
import habitReducer from '@store/habitSlice';
import calendarReducer from '@store/calendarSlice';
import plansReducer from '@store/plansSlice';
import journalReducer from '@store/journalSlice';
import coachReducer from '@store/coachSlice';

const rootReducer = combineReducers({
    auth: authReducer,
    habit: habitReducer,
    calendar: calendarReducer,
    plans: plansReducer,
    journal: journalReducer,
    coach: coachReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

/**
 * Builds an isolated store. Tests call this to get a fresh one per case with
 * whatever slice state they need preloaded, so no case can leak into the next.
 */
export const makeStore = (preloadedState?: Partial<RootState>) =>
    configureStore({ reducer: rootReducer, preloadedState });

export const store = makeStore();

export type AppDispatch = typeof store.dispatch;