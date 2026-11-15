import { configureStore } from '@reduxjs/toolkit';
import { api } from './api';
import { persistUi, uiReducer } from '../features/ui/uiSlice';
import { authReducer } from '../features/auth/authSlice';

export const store = configureStore({
  reducer: {
    ui: uiReducer,
    auth: authReducer,
    [api.reducerPath]: api.reducer,
  },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});

store.subscribe(() => persistUi(store.getState().ui));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
