import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { useDataStore } from './store/useDataStore';

declare global {
  interface Window {
    __DATA_STORE__?: typeof useDataStore;
  }
}

// Expose data store for dev and automated browser inspection
if (typeof window !== 'undefined') {
  window.__DATA_STORE__ = useDataStore;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
