import { Application } from 'pixi.js';

export async function initApp(container: HTMLElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#1a1a1a',
    antialias: true,
  });
  container.appendChild(app.canvas);
  return app;
}
