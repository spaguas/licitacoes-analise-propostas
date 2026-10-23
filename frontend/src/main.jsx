import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './estilos/base.css';
import './estilos/estrutura.css';
import './estilos/componentes.css';
import './estilos/paginas.css';
import './estilos/progresso.css';

createRoot(document.getElementById('raiz')).render(<StrictMode><App /></StrictMode>);
