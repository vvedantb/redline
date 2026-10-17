import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import About from './pages/About';
import Home from './pages/Home';
import Legacy from './pages/Legacy';
import './styles.css';

const router = createBrowserRouter(
  [
    { path: '/', element: <Home /> },
    { path: '/about', element: <About /> },
    { path: '/legacy', element: <Legacy /> },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
