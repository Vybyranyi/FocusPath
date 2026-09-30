import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { EmojiProvider } from "react-apple-emojis";
import emojiData from "react-apple-emojis/src/data.json";
import { Provider } from 'react-redux';
import { store } from '@store/store.ts';
import { BrowserRouter } from 'react-router';
import { ToastProvider } from '@components/ui/Toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <EmojiProvider data={emojiData}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </EmojiProvider>
      </BrowserRouter>
    </Provider>
  </StrictMode>,
)

// Production only. Under Vite's dev server the modules are served unbundled and
// change on every save, and a worker holding them would serve stale code.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a nicety; the app works the same without it.
    });
  });
}
