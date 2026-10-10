import { render } from 'solid-js/web';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { ConnectPage } from './connect/ConnectPage';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

if (window.location.pathname === '/connect') {
  render(() => <ConnectPage />, root);
} else {
  registerSW({ immediate: true });
  render(() => <App />, root);
}
