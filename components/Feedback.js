'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, tone = 'info') => {
    const id = crypto.randomUUID();
    setToasts(current => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 4200);
  }, []);
  const value = useMemo(() => notify, [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">{toast.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }

export function ErrorState({ title = 'Something went wrong', message, onRetry, compact = false }) {
  return (
    <div className={`error-state${compact ? ' error-state-compact' : ''}`} role="alert">
      <h3>{title}</h3>
      <p>{message || 'Please try again.'}</p>
      {onRetry && <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>Try Again</button>}
    </div>
  );
}
