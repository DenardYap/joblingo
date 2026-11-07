import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Theme accentColor="blue" grayColor="gray" radius="medium" appearance="light"><App /></Theme></StrictMode>);
