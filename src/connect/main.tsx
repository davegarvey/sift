import { render } from 'solid-js/web';
import { ConnectPage } from './ConnectPage';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

render(() => <ConnectPage />, root);
