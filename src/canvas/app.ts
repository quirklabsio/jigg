import { Application } from 'pixi.js';

export async function initApp(container: HTMLElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo:   window,
    background: '#f5f5f3', // match scene background so WebGL clear colour never bleeds through
    antialias:  true,
    resolution: window.devicePixelRatio,
    autoDensity: true,      // keeps CSS size at logical pixels while buffer is at physical pixels
  });
  container.appendChild(app.canvas);
  return app;
}
