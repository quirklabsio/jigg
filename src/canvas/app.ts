import { Application } from 'pixi.js';

export async function initApp(container: HTMLElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#f5f5f3', // match scene background so WebGL clear colour never bleeds through
    antialias: true,
  });
  container.appendChild(app.canvas);
  return app;
}
