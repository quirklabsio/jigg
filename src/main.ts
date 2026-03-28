/// <reference types="vite/client" />
import { initApp } from './canvas/app';
import { loadScene } from './canvas/scene';
import { activateDrag } from './puzzle/drag';

const TEST_IMAGE_URL = '/test-face.png';

const container = document.getElementById('app')!;
const app = await initApp(container);
await loadScene(app, TEST_IMAGE_URL);

// Enable the hit layer — sprites and drag wiring are set up inside loadScene.
activateDrag();
