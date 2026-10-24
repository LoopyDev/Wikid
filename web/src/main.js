import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './style.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import App from './App.vue';
import PrintApp from './PrintApp.vue';

const isPrint = window.location.pathname.startsWith('/print/');
const app = createApp(isPrint ? PrintApp : App);
app.config.compilerOptions.isCustomElement = (tag) => tag === 'emoji-picker';
const debugErrors = typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-errors') === '1';
if (debugErrors) {
  app.config.errorHandler = (err, instance, info) => {
    console.error('[error-debug] Vue error handler', { info, err, instance });
  };
  window.addEventListener('error', (event) => {
    console.error('[error-debug] window.error', event.error || event.message, event);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[error-debug] unhandledrejection', event.reason);
  });
}
app.use(createPinia());
app.mount('#app');
