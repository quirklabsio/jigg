/// <reference types="vite/client" />
import { initApp } from './canvas/app';
import { loadScene } from './canvas/scene';

const TEST_IMAGE_URL = '/test-image.jpg';

const container = document.getElementById('app')!;
const app = await initApp(container);
await loadScene(app, TEST_IMAGE_URL);
