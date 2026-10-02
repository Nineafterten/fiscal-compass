import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dropzone/styles.css';
import './index.css';

import { App } from './App';
import { theme } from './theme';
import { seedIfEmpty } from './db/database';

function render(children: React.ReactNode) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="top-right" />
        <BrowserRouter>{children}</BrowserRouter>
      </MantineProvider>
    </StrictMode>,
  );
}

/**
 * Seed before the first render so the dashboard never flashes an empty state.
 *
 * Deliberately a promise chain rather than top-level await: that would force
 * the build target up to ES2022 and drop older browsers for no gain.
 */
seedIfEmpty()
  .catch((error: unknown) => {
    // IndexedDB is unavailable in some private-browsing modes. The app still
    // renders — the user just gets the empty state instead of a blank page.
    console.error('Could not initialize local storage:', error);
  })
  .finally(() => render(<App />));
