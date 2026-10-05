import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import About from './pages/About';
import Contact from './pages/Contact';
import Home from './pages/Home';
import Settings from './pages/Settings';
import './styles.css';

const router = createBrowserRouter(
  [
    { path: '/', element: <Home /> },
    { path: '/about', element: <About /> },
    { path: '/contact', element: <Contact /> },
    { path: '/settings', element: <Settings /> },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
